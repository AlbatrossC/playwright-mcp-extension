/**
 * Playwright Control Center - Agent & Window Manager Dashboard
 * Clean minimal light styling based on design.html
 */

import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { getOrCreateAuthToken } from './authToken';
import './manage.css';

import type { PageMessage, SessionStatus } from '../types';

type AgentSessionView = {
  sessionId: number;
  clientName: string;
  windowId?: number;
  tabs: chrome.tabs.Tab[];
  focused: boolean;
};

const ManageApp: React.FC = () => {
  const [sessions, setSessions] = useState<AgentSessionView[]>([]);
  const [tokenValue, setTokenValue] = useState<string>(getOrCreateAuthToken);
  const [showToken, setShowToken] = useState<boolean>(false);
  const [tokenCopied, setTokenCopied] = useState<boolean>(false);
  const [envCopied, setEnvCopied] = useState<boolean>(false);
  const [promptCopied, setPromptCopied] = useState<boolean>(false);
  const [showPrompt, setShowPrompt] = useState<boolean>(false);
  const [profile, setProfile] = useState<string>('Default');
  const [time, setTime] = useState<string>('');
  const [version, setVersion] = useState<string>('0.9.7');

  const getBrowserName = (): string => {
    const ua = navigator.userAgent;
    if (ua.includes('Edg/')) return 'Microsoft Edge';
    if ((navigator as any).brave) return 'Brave';
    return 'Chrome';
  };

  const formatAgentName = (rawName?: string): string => {
    if (!rawName || !rawName.trim()) return 'AI Agent';

    // Remove internal transport prefixes (e.g. dynamic-session-)
    let text = rawName.trim().replace(/^dynamic[-_]session[-_]/i, '').trim();
    if (!text) return 'AI Agent';

    // Separate camelCase / PascalCase words (e.g. "myCrawler" -> "my Crawler")
    text = text.replace(/([a-z\d])([A-Z])/g, '$1 $2');

    // Split into tokens by hyphens, underscores, dots, or spaces
    const tokens = text.split(/[-_.\s]+/).filter(Boolean);
    if (tokens.length === 0) return 'AI Agent';

    // Format each token into Title Case, preserving standard acronyms
    const formatted = tokens.map(token => {
      const upper = token.toUpperCase();
      if (['AI', 'MCP', 'API', 'UI', 'ID', 'URL', 'PR', 'DB', 'CLI'].includes(upper)) {
        return upper;
      }
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    });

    const result = formatted.join(' ');

    // If the name does not already contain a role indicator, append "Agent" for clarity
    const lower = result.toLowerCase();
    const hasRoleSuffix = /\b(agent|bot|worker|crawler|scraper|runner|assistant|service)\b/i.test(lower);

    if (!hasRoleSuffix) {
      return `${result} Agent`;
    }

    return result;
  };

  useEffect(() => {
    try {
      const manifest = chrome.runtime.getManifest();
      if (manifest?.version) {
        setVersion(manifest.version);
      }
      chrome.storage.local.get(['auth-token'], result => {
        if (result && result['auth-token']) {
          setTokenValue(result['auth-token']);
          localStorage.setItem('auth-token', result['auth-token']);
        }
      });
    } catch (_) {}

    const updateTime = () => {
      setTime(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    };
    updateTime();
    const timer = setInterval(updateTime, 30000);
    return () => clearInterval(timer);
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      // 1. Fetch only active MCP agent sessions from background broker
      const response = await chrome.runtime.sendMessage<PageMessage>({ type: 'getStatus' }).catch(() => undefined);
      const rawSessions = (response?.sessions || []) as SessionStatus[];

      const sessionsList: AgentSessionView[] = [];

      for (const s of rawSessions) {
        const agentTabs: chrome.tabs.Tab[] = [];
        const seenTabIds = new Set<number>();

        if (s.tabIds && s.tabIds.length > 0) {
          for (const tabId of s.tabIds) {
            try {
              const tab = await chrome.tabs.get(tabId);
              if (tab && !seenTabIds.has(tab.id!)) {
                seenTabIds.add(tab.id!);
                agentTabs.push(tab);
              }
            } catch (_) {}
          }
        }

        let windowExists = !s.windowId;
        let windowFocused = false;
        if (s.windowId) {
          try {
            const win = await chrome.windows.get(s.windowId, { populate: true });
            if (win) {
              windowExists = true;
              windowFocused = !!win.focused;
              if (win.tabs) {
                for (const tab of win.tabs) {
                  if (tab.id && !seenTabIds.has(tab.id) && !tab.url?.startsWith('chrome-extension://')) {
                    seenTabIds.add(tab.id);
                    agentTabs.push(tab);
                  }
                }
              }
            }
          } catch (_) {
            windowExists = false;
          }
        }

        // Auto-purge dead/stopped sessions (window closed or 0 active agent tabs)
        if (!windowExists || agentTabs.length === 0) {
          void chrome.runtime.sendMessage<PageMessage>({ type: 'disconnect', sessionId: s.id }).catch(() => {});
          continue;
        }

        sessionsList.push({
          sessionId: s.id,
          clientName: formatAgentName(s.clientName),
          windowId: s.windowId,
          tabs: agentTabs,
          focused: windowFocused
        });
      }

      setSessions(sessionsList);
    } catch (_) {}
  }, []);

  useEffect(() => {
    void loadStatus();

    const reload = () => void loadStatus();
    chrome.tabs.onCreated.addListener(reload);
    chrome.tabs.onUpdated.addListener(reload);
    chrome.tabs.onRemoved.addListener(reload);
    chrome.windows.onCreated.addListener(reload);
    chrome.windows.onRemoved.addListener(reload);

    const interval = setInterval(loadStatus, 3000);

    return () => {
      chrome.tabs.onCreated.removeListener(reload);
      chrome.tabs.onUpdated.removeListener(reload);
      chrome.tabs.onRemoved.removeListener(reload);
      chrome.windows.onCreated.removeListener(reload);
      chrome.windows.onRemoved.removeListener(reload);
      clearInterval(interval);
    };
  }, [loadStatus]);

  const focusWindow = async (windowId?: number, tabId?: number) => {
    if (tabId) {
      await chrome.tabs.update(tabId, { active: true }).catch(() => {});
    }
    if (windowId) {
      await chrome.windows.update(windowId, { focused: true }).catch(() => {});
    }
    await loadStatus();
  };

  const disconnectSession = async (sessionId: number) => {
    await chrome.runtime.sendMessage<PageMessage>({ type: 'disconnect', sessionId }).catch(() => {});
    await loadStatus();
  };

  const onRotateToken = () => {
    if (!confirm('Rotate the token? You will need to update your MCP config.')) return;
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const newToken = btoa(String.fromCharCode.apply(null, Array.from(array)))
      .replace(/[+/=]/g, m => (m === '+' ? '-' : m === '/' ? '_' : ''));
    localStorage.setItem('auth-token', newToken);
    try {
      chrome.storage.local.set({ 'auth-token': newToken });
    } catch (_) {}
    setTokenValue(newToken);
  };

  const buildPrompt = (maskToken: boolean): string => {
    const prof = profile.trim() || 'Default';
    const config = {
      mcpServers: {
        'playwright-extension': {
          command: 'playwright-mcp-extension',
          env: {
            PLAYWRIGHT_MCP_EXTENSION_TOKEN: maskToken ? '<hidden: added when copied>' : tokenValue,
            PLAYWRIGHT_CHROME_PROFILE: prof
          }
        }
      }
    };
    return [
      'Add an MCP server called "playwright-extension" to your environment.',
      '',
      '1. Open your MCP config file (for Google Antigravity: ~/.gemini/config/mcp_config.json).',
      '2. Merge this entry into the "mcpServers" object. Keep any servers already there:',
      '',
      JSON.stringify(config, null, 2),
      '',
      '3. Save the file, then restart the agent so it loads the new server.',
      '',
      'How to use it: every browser tool takes a session_id. Use a different session_id for each agent (for example "agent-1", "agent-2"). Each session_id opens its own Chrome window. Reuse the same session_id to stay in the same window, and call browser_close_session when you are done.'
    ].join('\n');
  };

  const copyText = async (text: string, setCopied: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch (_) {}
    setTimeout(() => setCopied(false), 1500);
  };

  const totalTabs = sessions.reduce((n, s) => n + s.tabs.length, 0);

  const getInitialHostLetter = (url?: string): string => {
    if (!url) return 'W';
    try {
      const host = new URL(url).hostname;
      return host.replace(/^www\./, '').charAt(0).toUpperCase() || 'W';
    } catch {
      return 'W';
    }
  };

  return (
    <div className='wrap'>
      <header>
        <div className='logo' aria-hidden='true'>
          <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round'>
            <rect x='3' y='4' width='18' height='12' rx='2'/>
            <path d='M8 20h8M12 16v4'/>
          </svg>
        </div>
        <div className='title'>
          <h1>
            Playwright Control Center <span className='chip'>v{version}</span> <span className='chip'>{getBrowserName()}</span>
          </h1>
          <p className='sub'>One dedicated window per Antigravity agent</p>
        </div>
        <div className='stats'>
          <span className='stat'>
            <span className='dot'></span>
            <b>{sessions.length}</b> active {sessions.length === 1 ? 'agent' : 'agents'}
          </span>
          <span className='stat'>
            <b>{totalTabs}</b> agent {totalTabs === 1 ? 'tab' : 'tabs'}
          </span>
        </div>
      </header>

      <div className='grid'>
        <main>
          <div className='section-head'>
            <h2>Agent workspaces<span className='count'>{sessions.length}</span></h2>
            <span className='hint'>Live &middot; {time}</span>
          </div>
          <p className='lead'>Only windows and tabs controlled by AI agents are shown. Click a tab to bring it to the front.</p>

          {sessions.length === 0 ? (
            <div className='card empty'>
              <h3>No active agent sessions</h3>
              <p>Your browser is connected and listening on port 45454. When an agent starts browsing, its dedicated window appears here.</p>
            </div>
          ) : (
            <div className='sessions'>
              {sessions.map(s => (
                <div className='card' key={s.sessionId}>
                  <div className='session-head'>
                    <span className='dot'></span>
                    <span className='name'>{s.clientName}</span>
                    {s.windowId && <span className='chip mono'>Window #{s.windowId}</span>}
                    <span className='chip'>Session #{s.sessionId}</span>
                    <span className='chip'>{s.tabs.length} {s.tabs.length === 1 ? 'tab' : 'tabs'}</span>
                    <div className='actions'>
                      {s.windowId && (
                        <button type='button' onClick={() => focusWindow(s.windowId, s.tabs[0]?.id)}>
                          Focus window
                        </button>
                      )}
                      <button type='button' onClick={() => disconnectSession(s.sessionId)}>
                        Disconnect
                      </button>
                    </div>
                  </div>

                  {s.tabs.map(t => (
                    <div
                      className={`tab ${t.active ? 'focused' : ''}`}
                      key={t.id}
                      tabIndex={0}
                      title='Focus this tab'
                      onClick={() => focusWindow(s.windowId, t.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          focusWindow(s.windowId, t.id);
                        }
                      }}
                    >
                      <div className='fav'>
                        {t.favIconUrl ? (
                          <img
                            src={t.favIconUrl}
                            alt=''
                            onError={e => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          getInitialHostLetter(t.url)
                        )}
                      </div>
                      <div className='info'>
                        <div className='t'>{t.title || 'Loading...'}</div>
                        <div className='u mono'>{t.url || 'about:blank'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </main>

        <aside>
          <section className='card pad'>
            <div className='section-head'><h2>Authentication token</h2></div>
            <p className='lead'>Add this to your MCP configuration so agents connect without a browser prompt.</p>

            <div className='token-key-badge'>
              <span className='token-key-label'>Environment variable:</span>
              <code className='mono'>PLAYWRIGHT_MCP_EXTENSION_TOKEN</code>
            </div>

            <div className='field token-field'>
              <code className='mono token-value' aria-label='Authentication token'>
                {showToken ? tokenValue : '•'.repeat(32)}
              </code>
            </div>

            <div className='btn-row'>
              <button
                type='button'
                className='primary grow'
                title='Copy token value only'
                onClick={() => copyText(tokenValue, setTokenCopied)}
              >
                {tokenCopied ? '✓ Copied Token' : 'Copy token'}
              </button>
              <button
                type='button'
                title='Copy full env: PLAYWRIGHT_MCP_EXTENSION_TOKEN=token'
                onClick={() => copyText(`PLAYWRIGHT_MCP_EXTENSION_TOKEN=${tokenValue}`, setEnvCopied)}
              >
                {envCopied ? '✓ Copied Env' : 'Copy as KEY=VAL'}
              </button>
            </div>

            <div className='btn-row sub-row'>
              <button type='button' className='grow' onClick={() => setShowToken(!showToken)}>
                {showToken ? 'Hide token' : 'Show token'}
              </button>
              <button type='button' onClick={onRotateToken} title='Regenerate authentication token'>
                Rotate
              </button>
            </div>

            <div className='foot'>
              <span className='dot'></span>
              <span><b>Control plane</b> 127.0.0.1:45454</span>
            </div>
          </section>

          <section className='card pad'>
            <div className='section-head'><h2>Set up an AI agent</h2></div>
            <p className='lead'>Give an agent this prompt and it will add the MCP server to its own environment.</p>
            <label htmlFor='profile'>Browser profile</label>
            <input
              id='profile'
              className='mono'
              spellCheck={false}
              value={profile}
              onChange={e => setProfile(e.target.value)}
            />
            <p className='note' id='profile-note'>Folder name from the Profile Path on the browser’s version page.</p>
            <div className='btn-row' style={{ marginTop: 0 }}>
              <button type='button' onClick={() => setShowPrompt(!showPrompt)}>
                {showPrompt ? 'Hide prompt' : 'Show prompt'}
              </button>
              <button
                type='button'
                className='primary grow'
                onClick={() => copyText(buildPrompt(false), setPromptCopied)}
              >
                {promptCopied ? 'Copied' : 'Copy prompt'}
              </button>
            </div>
            {showPrompt && <pre>{buildPrompt(true)}</pre>}
            <p className='note' style={{ margin: '10px 0 0' }}>Your token is included when you copy, and hidden in the preview.</p>
          </section>
        </aside>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<ManageApp />);
