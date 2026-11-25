/**
 * Parallel multi-tab URL loader and DOM extractor for fast company research.
 */

export type MultiTabExtractRequest = {
  requestId: string;
  sessionId?: string;
  urls: string[];
  extractMode?: 'serp' | 'page_text';
  maxChars?: number;
  waitMs?: number;
  timeoutMs?: number;
  closeTabs?: boolean;
};

export type MultiTabResultItem = {
  url: string;
  finalUrl?: string;
  title?: string;
  status: 'ok' | 'timeout' | 'error';
  captchaDetected?: boolean;
  results?: Array<{ title: string; url: string; snippet: string }>;
  text?: string;
  navLinks?: Array<{ text: string; url: string }>;
  error?: string;
};

export type MultiTabExtractResponse = {
  ok: boolean;
  durationMs: number;
  captchaDetected: boolean;
  items: MultiTabResultItem[];
  error?: string;
};

function waitForTabComplete(tabId: number, timeoutMs: number): Promise<'complete' | 'timeout'> {
  return new Promise(resolve => {
    let settled = false;
    const done = (outcome: 'complete' | 'timeout') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      resolve(outcome);
    };

    const onUpdated = (updatedId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedId === tabId && changeInfo.status === 'complete')
        done('complete');
    };

    const onRemoved = (removedId: number) => {
      if (removedId === tabId)
        done('timeout');
    };

    const timer = setTimeout(() => done('timeout'), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    // Handle case where tab already finished before listener attached
    void chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete')
        done('complete');
    }).catch(() => done('timeout'));
  });
}

function extractSerpInPage(maxResults: number) {
  const href = window.location.href;
  const title = document.title || '';
  const bodyText = (document.body?.innerText || '').slice(0, 3000);
  const captchaDetected =
    href.includes('/sorry/') ||
    Boolean(document.querySelector('#captcha-form, .g-recaptcha, iframe[src*="recaptcha"], iframe[src*="hcaptcha"]')) ||
    /unusual traffic from your computer|verify you are human|are you a robot|please show you're not a robot/i.test(bodyText);

  const items: Array<{ title: string; url: string; snippet: string }> = [];
  const seen = new Set<string>();
  const pushItem = (t?: string | null, u?: string | null, s?: string | null) => {
    const cleanUrl = (u || '').trim();
    const cleanTitle = (t || '').trim();
    if (!cleanUrl || !cleanTitle || !cleanUrl.startsWith('http') || seen.has(cleanUrl)) return;
    seen.add(cleanUrl);
    items.push({
      title: cleanTitle.slice(0, 200),
      url: cleanUrl,
      snippet: (s || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    });
  };

  if (href.includes('google.')) {
    const blocks = document.querySelectorAll('div.g, div.MjjYud');
    for (const block of blocks) {
      const a = block.querySelector('a[href^="http"]');
      const h3 = block.querySelector('h3');
      const snip = block.querySelector('div.VwiC3b, span.aCOpRe, div[data-sncf]');
      if (a && h3)
        pushItem(h3.textContent, a.getAttribute('href'), snip?.textContent);
      if (items.length >= maxResults) break;
    }
  } else if (href.includes('duckduckgo.com')) {
    const blocks = document.querySelectorAll('.result, article[data-testid="result"], .web-result');
    for (const block of blocks) {
      const a = block.querySelector('a.result__a, a[data-testid="result-title-a"], h2 a');
      const snip = block.querySelector('.result__snippet, [data-result="snippet"]');
      if (a)
        pushItem(a.textContent, (a as HTMLAnchorElement).href, snip?.textContent);
      if (items.length >= maxResults) break;
    }
  } else if (href.includes('bing.com')) {
    const blocks = document.querySelectorAll('li.b_algo');
    for (const block of blocks) {
      const a = block.querySelector('h2 a');
      const snip = block.querySelector('.b_caption p, p.b_lineclamp2, p.b_lineclamp3, p.b_lineclamp4');
      if (a)
        pushItem(a.textContent, (a as HTMLAnchorElement).href, snip?.textContent);
      if (items.length >= maxResults) break;
    }
  }

  // Generic fallback if engine selector didn't match
  if (items.length === 0 && !captchaDetected) {
    const links = document.querySelectorAll('main a[href^="http"], #search a[href^="http"]');
    for (const a of links) {
      const h = a.querySelector('h2, h3') || a;
      pushItem(h.textContent, (a as HTMLAnchorElement).href, a.parentElement?.textContent);
      if (items.length >= maxResults) break;
    }
  }

  return { finalUrl: href, title, captchaDetected, results: items };
}

function extractPageTextInPage(maxChars: number) {
  const href = window.location.href;
  const title = document.title || '';
  const rawText = (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  const captchaDetected = /verify you are human|checking your browser|access denied|just a moment/i.test(rawText.slice(0, 1200));

  const navLinks: Array<{ text: string; url: string }> = [];
  const seen = new Set<string>();
  const interesting = /about|course|training|bootcamp|program|career|job|contact|pricing|fee|placement/i;
  for (const a of document.querySelectorAll('a[href]')) {
    const anchor = a as HTMLAnchorElement;
    const text = (anchor.innerText || '').replace(/\s+/g, ' ').trim();
    const url = anchor.href;
    if (!url || !url.startsWith('http') || seen.has(url)) continue;
    if (interesting.test(text) || interesting.test(url)) {
      seen.add(url);
      navLinks.push({ text: text.slice(0, 80), url });
      if (navLinks.length >= 15) break;
    }
  }

  return {
    finalUrl: href,
    title,
    captchaDetected,
    text: rawText.slice(0, maxChars),
    navLinks,
  };
}

export async function runMultiTabExtract(
  req: MultiTabExtractRequest,
  windowId?: number
): Promise<MultiTabExtractResponse> {
  const started = Date.now();
  const urls = Array.isArray(req.urls) ? req.urls.slice(0, 6) : [];
  if (urls.length === 0) {
    return { ok: false, durationMs: 0, captchaDetected: false, items: [], error: 'No URLs provided' };
  }

  const extractMode = req.extractMode === 'page_text' ? 'page_text' : 'serp';
  const maxChars = Math.min(Math.max(req.maxChars ?? 4000, 500), 15000);
  const waitMs = Math.min(Math.max(req.waitMs ?? 400, 0), 5000);
  const timeoutMs = Math.min(Math.max(req.timeoutMs ?? 10000, 2000), 30000);
  const closeTabs = req.closeTabs !== false;

  const createdTabIds: number[] = [];
  let tempWindowId: number | undefined;
  let targetWindowId = windowId;

  try {
    if (targetWindowId === undefined) {
      const win = await chrome.windows.create({ url: 'about:blank', focused: false, type: 'normal' });
      tempWindowId = win?.id;
      targetWindowId = tempWindowId;
    }

    const items = await Promise.all(
      urls.map(async (url): Promise<MultiTabResultItem> => {
        let tab: chrome.tabs.Tab | undefined;
        try {
          tab = await chrome.tabs.create({
            ...(targetWindowId !== undefined ? { windowId: targetWindowId } : {}),
            url,
            active: false,
          });
          if (!tab.id) {
            return { url, status: 'error', error: 'Failed to create tab' };
          }
          createdTabIds.push(tab.id);

          const loadOutcome = await waitForTabComplete(tab.id, timeoutMs);
          if (waitMs > 0)
            await new Promise(r => setTimeout(r, waitMs));

          const execResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractMode === 'page_text' ? extractPageTextInPage : extractSerpInPage,
            args: [extractMode === 'page_text' ? maxChars : 8],
          });

          const payload = execResults?.[0]?.result as any;
          if (!payload) {
            return {
              url,
              status: loadOutcome === 'timeout' ? 'timeout' : 'error',
              error: 'No script result returned',
            };
          }

          return {
            url,
            finalUrl: payload.finalUrl,
            title: payload.title,
            status: loadOutcome === 'timeout' ? 'timeout' : 'ok',
            captchaDetected: Boolean(payload.captchaDetected),
            ...(payload.results ? { results: payload.results } : {}),
            ...(payload.text !== undefined ? { text: payload.text } : {}),
            ...(payload.navLinks ? { navLinks: payload.navLinks } : {}),
          };
        } catch (err: any) {
          return {
            url,
            status: 'error',
            error: err?.message ?? String(err),
          };
        }
      })
    );

    return {
      ok: true,
      durationMs: Date.now() - started,
      captchaDetected: items.some(i => i.captchaDetected),
      items,
    };
  } finally {
    if (closeTabs && createdTabIds.length > 0) {
      await chrome.tabs.remove(createdTabIds).catch(() => {});
    }
    if (closeTabs && tempWindowId !== undefined) {
      await chrome.windows.remove(tempWindowId).catch(() => {});
    }
  }
}
