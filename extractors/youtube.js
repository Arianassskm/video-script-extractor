// YouTube Transcript Extractor
// Strategy: Read caption data from the YouTube page's own JS context
// via chrome.scripting.executeScript (MAIN world).
//
// For transcript content: use InnerTube get_transcript API from page context
// (same API YouTube's own transcript panel uses).
// Caption baseUrl can occasionally return empty due to token/format constraints,
// so direct fetch is only used as a fallback with multi-format retries.

const YouTubeExtractor = {
  name: 'YouTube',
  needsPageContext: true,

  canHandle(url) {
    return /^https?:\/\/((www|m)\.)?youtube\.com\/(watch|shorts)\b/.test(url)
      || /^https?:\/\/youtu\.be\//.test(url);
  },

  getVideoId(url) {
    try {
      const u = new URL(url);
      if (u.hostname === 'youtu.be') {
        return u.pathname.replace(/^\/+/, '').split('/')[0] || null;
      }
      if (u.pathname.startsWith('/shorts/')) {
        return u.pathname.split('/').filter(Boolean)[1] || null;
      }
      return u.searchParams.get('v');
    } catch {
      return null;
    }
  },

  // Get caption tracks by reading the page's JS variables
  async getAvailableLanguages(url, tabId) {
    if (!tabId) {
      console.error('[YouTubeExtractor] tabId required for page context');
      return [];
    }

    try {
      const requestedVideoId = this.getVideoId(url);
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (expectedVideoId) => {
          const getLocationVideoId = () => {
            try {
              return new URL(location.href).searchParams.get('v');
            } catch {
              return null;
            }
          };

          const getCurrentVideoId = () => {
            const fromLocation = getLocationVideoId();
            if (fromLocation) return fromLocation;
            try {
              const player = document.querySelector('#movie_player');
              const fromData = player?.getVideoData?.()?.video_id;
              if (fromData) return fromData;
            } catch (e) {}
            return expectedVideoId || null;
          };

          const currentVideoId = getCurrentVideoId();
          const getResponseVideoId = (pr) => (
            pr?.videoDetails?.videoId
            || pr?.microformat?.playerMicroformatRenderer?.externalVideoId
            || null
          );
          const getTracksFromResponse = (pr) => (
            pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks
          );

          const sources = [];
          try {
            const player = document.querySelector('#movie_player');
            const pr = player?.getPlayerResponse?.();
            if (pr) sources.push({ source: 'movie_player', playerResponse: pr });
          } catch (e) {}
          try {
            const flexy = document.querySelector('ytd-watch-flexy');
            const pr = flexy?.playerData
              || flexy?.__data?.playerResponse
              || flexy?.data?.playerResponse;
            if (pr) sources.push({ source: 'ytd-watch-flexy', playerResponse: pr });
          } catch (e) {}
          try {
            const pr = window.ytInitialPlayerResponse;
            if (pr) sources.push({ source: 'ytInitialPlayerResponse', playerResponse: pr });
          } catch (e) {}

          let selectedTracks = null;
          let selectedSource = 'none';
          for (const item of sources) {
            const pr = item.playerResponse;
            const responseVideoId = getResponseVideoId(pr);
            if (currentVideoId) {
              if (!responseVideoId || responseVideoId !== currentVideoId) {
                continue;
              }
            }
            const tracks = getTracksFromResponse(pr);
            if (!Array.isArray(tracks) || tracks.length === 0) continue;
            selectedTracks = tracks;
            selectedSource = item.source;
            break;
          }

          if (!selectedTracks || selectedTracks.length === 0) {
            return {
              tracks: [],
              meta: {
                currentVideoId,
                source: selectedSource,
                noTracks: true
              }
            };
          }

          const normalizeTrackUrl = (track) => {
            if (!track?.baseUrl) return '';
            try {
              const u = new URL(track.baseUrl, location.href);
              if (currentVideoId && !u.searchParams.get('v')) u.searchParams.set('v', currentVideoId);
              if (track.languageCode && !u.searchParams.get('lang')) u.searchParams.set('lang', track.languageCode);
              if (track.kind && !u.searchParams.get('kind')) u.searchParams.set('kind', track.kind);
              return u.toString();
            } catch {
              return track.baseUrl;
            }
          };

          const unique = new Set();
          const tracks = [];
          for (const t of selectedTracks) {
            const url = normalizeTrackUrl(t);
            const code = t?.languageCode || '';
            const kind = t?.kind || '';
            if (!code || !url) continue;
            const dedupeKey = `${code}|${kind}|${url}`;
            if (unique.has(dedupeKey)) continue;
            unique.add(dedupeKey);
            tracks.push({
              code,
              name: t.name?.simpleText || t.name?.runs?.[0]?.text || code,
              url,
              kind,
              isAutoGenerated: kind === 'asr'
            });
          }

          return {
            tracks,
            meta: {
              currentVideoId,
              source: selectedSource,
              noTracks: tracks.length === 0
            }
          };
        },
        args: [requestedVideoId]
      });

      const payload = results?.[0]?.result || {};
      const tracks = payload?.tracks || [];
      const currentVideoId = payload?.meta?.currentVideoId || requestedVideoId || 'N/A';
      if (!tracks || tracks.length === 0) {
        console.log('[YouTubeExtractor] No page-context tracks, trying ANDROID client fallback...');
        // Fallback: Use ANDROID InnerTube client from page context (MAIN world).
        // The ANDROID client often returns caption tracks that the WEB client omits.
        const androidTracks = await this._fetchCaptionTracksViaAndroidClient(currentVideoId || requestedVideoId, tabId);
        if (androidTracks && androidTracks.length > 0) {
          console.log('[YouTubeExtractor] ANDROID client returned', androidTracks.length, 'tracks');
          return androidTracks.map(t => ({
            ...t,
            nameAlreadyMarked: (t.name || '').includes('自动生成') || (t.name || '').includes('auto-generated')
          }));
        }
        console.log('[YouTubeExtractor] ANDROID client also returned no tracks for:', currentVideoId);
        return [];
      }

      console.log('[YouTubeExtractor] Got', tracks.length, 'tracks from page context, videoId=', currentVideoId);

      return tracks.map(t => ({
        ...t,
        nameAlreadyMarked: (t.name || '').includes('自动生成') || (t.name || '').includes('auto-generated')
      }));
    } catch (e) {
      console.error('[YouTubeExtractor] getAvailableLanguages failed:', e);
      return [];
    }
  },

  // Fetch transcript using InnerTube get_transcript API from page context.
  // This is the same API YouTube's transcript panel uses.
  // We only fallback to caption baseUrl direct fetch when API parsing fails.
  async getTranscript(captionUrl, tabId) {
    if (!tabId) {
      console.error('[YouTubeExtractor] tabId required');
      return null;
    }

    // Extract video ID from the selected caption URL
    const requestedVideoId = (() => {
      try {
        const u = new URL(captionUrl);
        return u.searchParams.get('v');
      } catch { return null; }
    })();

    console.log('[YouTubeExtractor] Fetching transcript via InnerTube get_transcript, requestedVideoId:', requestedVideoId);

    try {
      // Refresh caption URL from live page data to avoid expired timedtext URLs.
      const refreshed = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (inputUrl, expectedVideoId) => {
          try {
            const parsed = new URL(inputUrl, location.href);
            const wantedLang = parsed.searchParams.get('lang');
            const wantedKind = parsed.searchParams.get('kind') || '';
            const wantedName = parsed.searchParams.get('name') || '';

            const getCurrentVideoId = () => {
              try {
                const fromLocation = new URL(location.href).searchParams.get('v');
                if (fromLocation) return fromLocation;
              } catch (e) {}
              try {
                const player = document.querySelector('#movie_player');
                const fromData = player?.getVideoData?.()?.video_id;
                if (fromData) return fromData;
              } catch (e) {}
              return expectedVideoId || null;
            };

            const currentVideoId = getCurrentVideoId();
            const getResponseVideoId = (pr) => (
              pr?.videoDetails?.videoId
              || pr?.microformat?.playerMicroformatRenderer?.externalVideoId
              || null
            );
            const getTracksFromResponse = (pr) => (
              pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks
            );

            const sourceResponses = [];
            try {
              const player = document.querySelector('#movie_player');
              const pr = player?.getPlayerResponse?.();
              if (pr) sourceResponses.push({ source: 'movie_player', playerResponse: pr });
            } catch (e) {}
            try {
              const flexy = document.querySelector('ytd-watch-flexy');
              const pr = flexy?.playerData
                || flexy?.__data?.playerResponse
                || flexy?.data?.playerResponse;
              if (pr) sourceResponses.push({ source: 'ytd-watch-flexy', playerResponse: pr });
            } catch (e) {}
            try {
              const pr = window.ytInitialPlayerResponse;
              if (pr) sourceResponses.push({ source: 'ytInitialPlayerResponse', playerResponse: pr });
            } catch (e) {}

            let tracks = [];
            let selectedSource = 'none';
            let sawCurrentVideoResponse = false;
            for (const item of sourceResponses) {
              const pr = item.playerResponse;
              const responseVideoId = getResponseVideoId(pr);
              if (currentVideoId) {
                if (!responseVideoId || responseVideoId !== currentVideoId) {
                  continue;
                }
                sawCurrentVideoResponse = true;
              } else if (responseVideoId) {
                sawCurrentVideoResponse = true;
              }
              const candidateTracks = getTracksFromResponse(pr);
              if (!Array.isArray(candidateTracks) || candidateTracks.length === 0) {
                continue;
              }
              tracks = candidateTracks;
              selectedSource = item.source;
              break;
            }

            if (!tracks.length) {
              return {
                url: inputUrl,
                refreshed: false,
                noTracks: sawCurrentVideoResponse,
                currentVideoId,
                source: selectedSource,
                reason: sawCurrentVideoResponse
                  ? 'current_video_no_caption_tracks'
                  : 'current_video_response_not_ready'
              };
            }

            const matched = tracks.find(t =>
              t?.baseUrl
              && (!wantedLang || t.languageCode === wantedLang)
              && (t.kind || '') === wantedKind
              && ((t.vssId || '').includes(wantedName) || !wantedName)
            ) || tracks.find(t =>
              t?.baseUrl && (!wantedLang || t.languageCode === wantedLang)
            ) || tracks.find(t => t?.baseUrl);

            if (!matched?.baseUrl) {
              return {
                url: inputUrl,
                refreshed: false,
                noTracks: false,
                currentVideoId,
                source: selectedSource,
                reason: 'current_video_tracks_without_base_url'
              };
            }

            const normalizedUrl = (() => {
              try {
                const u = new URL(matched.baseUrl, location.href);
                if (currentVideoId && !u.searchParams.get('v')) u.searchParams.set('v', currentVideoId);
                if (matched.languageCode && !u.searchParams.get('lang')) {
                  u.searchParams.set('lang', matched.languageCode);
                }
                if (matched.kind && !u.searchParams.get('kind')) u.searchParams.set('kind', matched.kind);
                return u.toString();
              } catch {
                return matched.baseUrl;
              }
            })();

            return {
              url: normalizedUrl,
              refreshed: normalizedUrl !== inputUrl,
              noTracks: false,
              currentVideoId,
              source: selectedSource,
              reason: 'ok'
            };
          } catch (e) {
            return {
              url: inputUrl,
              refreshed: false,
              noTracks: false,
              currentVideoId: expectedVideoId || null,
              source: 'refresh_exception',
              reason: e?.message || String(e)
            };
          }
        },
        args: [captionUrl, requestedVideoId]
      });

      const refreshInfo = refreshed?.[0]?.result || {};
      const liveCaptionUrl = refreshInfo?.url || captionUrl;
      const effectiveVideoId = refreshInfo?.currentVideoId || requestedVideoId || null;
      const refreshNoTracks = Boolean(refreshInfo?.noTracks);
      if (refreshNoTracks) {
        const noTracksMsg = [
          '[YouTubeExtractor] 当前视频无可访问字幕轨道',
          `videoId=${effectiveVideoId || 'N/A'}`,
          `reason=${refreshInfo?.reason || 'unknown'}`,
          `source=${refreshInfo?.source || 'unknown'}`
        ].join('; ');
        // Do not short-circuit here: selected captionUrl may still be fetchable.
        console.warn(noTracksMsg, '; fallback=continue_with_selected_caption_url');
      }
      if (liveCaptionUrl !== captionUrl) {
        console.log('[YouTubeExtractor] Refreshed caption URL from page context');
      }

      // Strategy -1: Try extracting transcript already present in page DOM/data graph.
      // This bypasses network calls entirely when transcript panel/content is already in memory.
      console.log('[YouTubeExtractor] Trying in-page transcript graph extraction...');
      const inPageTranscriptResult = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
          try {
            const normalize = (text) => String(text || '')
              .replace(/<[^>]+>/g, '')
              .replace(/\s+/g, ' ')
              .trim();
            const parseTs = (s) => {
              const t = String(s || '').trim();
              if (!t) return null;
              const parts = t.split(':').map(x => parseFloat(x));
              if (parts.some(Number.isNaN)) return null;
              if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
              if (parts.length === 2) return parts[0] * 60 + parts[1];
              if (parts.length === 1) return parts[0];
              return null;
            };
            const dedupeAndSort = (rows) => {
              const seen = new Set();
              const out = [];
              for (const row of rows) {
                const text = normalize(row.text);
                const start = Number(row.start || 0);
                const duration = Math.max(0, Number(row.duration || 0));
                if (!text) continue;
                const key = `${Math.round(start * 1000)}|${text}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({ start, duration, text });
              }
              out.sort((a, b) => a.start - b.start);
              return out;
            };

            // A) Transcript panel DOM
            const domRows = [];
            const segmentNodes = document.querySelectorAll('ytd-transcript-segment-renderer');
            for (const node of Array.from(segmentNodes)) {
              const tsEl = node.querySelector('#start-offset, .segment-timestamp, yt-formatted-string.segment-timestamp');
              const txtEl = node.querySelector('#segment-text, .segment-text, yt-formatted-string.segment-text');
              const start = parseTs(tsEl?.textContent || '');
              const text = normalize(txtEl?.textContent || '');
              if (start !== null && text) domRows.push({ start, duration: 0, text });
            }
            const domLines = dedupeAndSort(domRows);
            if (domLines.length > 0) {
              return { error: null, source: 'dom_panel', lines: domLines };
            }

            // B) In-memory graph scan
            const roots = [
              window.ytInitialData,
              window.ytInitialPlayerResponse,
              document.querySelector('ytd-watch-flexy')?.data,
              document.querySelector('#movie_player')?.getPlayerResponse?.()
            ].filter(Boolean);
            const queue = roots.slice();
            const seenNodes = new Set();
            const rows = [];
            let steps = 0;

            while (queue.length > 0 && steps < 80000) {
              const node = queue.shift();
              steps += 1;
              if (!node || typeof node !== 'object' || seenNodes.has(node)) continue;
              seenNodes.add(node);

              const seg = node.transcriptSegmentRenderer;
              if (seg) {
                const text = normalize(seg.snippet?.runs?.map(r => r.text).join('') || seg.snippet?.simpleText || '');
                const start = Number(seg.startMs || 0) / 1000;
                const end = Number(seg.endMs || seg.startMs || 0) / 1000;
                if (text) rows.push({ start, duration: Math.max(0, end - start), text });
              }

              const cue = node.transcriptCueRenderer;
              if (cue) {
                const text = normalize(cue.cue?.simpleText || cue.cue?.runs?.map(r => r.text).join('') || '');
                const start = Number(cue.startOffsetMs || 0) / 1000;
                const duration = Number(cue.durationMs || 0) / 1000;
                if (text) rows.push({ start, duration, text });
              }

              const cueGroup = node.transcriptCueGroupRenderer;
              if (cueGroup && Array.isArray(cueGroup.cues)) {
                for (const c of cueGroup.cues) {
                  const r = c?.transcriptCueRenderer;
                  if (!r) continue;
                  const text = normalize(r.cue?.simpleText || r.cue?.runs?.map(x => x.text).join('') || '');
                  const start = Number(r.startOffsetMs || 0) / 1000;
                  const duration = Number(r.durationMs || 0) / 1000;
                  if (text) rows.push({ start, duration, text });
                }
              }

              for (const key of Object.keys(node)) {
                const child = node[key];
                if (child && typeof child === 'object') queue.push(child);
              }
            }

            const graphLines = dedupeAndSort(rows);
            if (graphLines.length > 0) {
              return { error: null, source: 'graph_scan', lines: graphLines };
            }
            return { error: 'No transcript lines in DOM/graph', source: 'graph_scan', lines: null };
          } catch (e) {
            return { error: e.message || String(e), source: 'graph_scan', lines: null };
          }
        }
      });

      const inPageLines = inPageTranscriptResult?.[0]?.result?.lines;
      const inPageSource = inPageTranscriptResult?.[0]?.result?.source || 'unknown';
      const inPageError = inPageTranscriptResult?.[0]?.result?.error || 'none';
      if (inPageLines && inPageLines.length > 0) {
        console.log('[YouTubeExtractor] in-page transcript success:', inPageSource, inPageLines.length, 'lines');
        return inPageLines;
      }
      console.log('[YouTubeExtractor] in-page transcript failed:', inPageSource, inPageError);

      // Strategy 0: Browser textTracks fallback from video element.
      // This uses browser-managed subtitle tracks and bypasses InnerTube precondition checks.
      console.log('[YouTubeExtractor] Trying video.textTracks fallback...');
      const textTrackResult = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (url) => {
          try {
            const targetLang = (() => {
              try {
                return new URL(url, location.href).searchParams.get('lang');
              } catch {
                return null;
              }
            })();

            const video = document.querySelector('video');
            if (!video || !video.textTracks || video.textTracks.length === 0) {
              return { error: 'No textTracks on video', lines: null };
            }

            const tracks = Array.from(video.textTracks);
            const pickTrack = () => {
              if (!targetLang) return tracks[0];
              const exact = tracks.find(t =>
                (t.language || '').toLowerCase() === targetLang.toLowerCase()
                || (t.label || '').toLowerCase().includes(targetLang.toLowerCase())
              );
              return exact || tracks[0];
            };

            const track = pickTrack();
            if (!track) return { error: 'No matching textTrack', lines: null };

            const oldMode = track.mode;
            let modeTouched = false;

            // Non-invasive: only switch to hidden if cues are not already available.
            if (!track.cues || track.cues.length === 0) {
              track.mode = 'hidden';
              modeTouched = true;
            }

            const waitForCues = async () => {
              const start = Date.now();
              while (Date.now() - start < 5000) {
                const cues = track.cues;
                if (cues && cues.length > 0) return cues;
                await new Promise(resolve => setTimeout(resolve, 200));
              }
              return track.cues;
            };

            let cues = null;
            try {
              cues = await waitForCues();
            } finally {
              if (modeTouched) {
                track.mode = oldMode;
              }
            }

            if (!cues || cues.length === 0) {
              return { error: 'No cues loaded from textTrack', lines: null };
            }

            const lines = [];
            for (const cue of Array.from(cues)) {
              const text = String(cue.text || '')
                .replace(/<[^>]+>/g, '')
                .replace(/\s+/g, ' ')
                .trim();
              if (!text) continue;
              lines.push({
                start: Number(cue.startTime || 0),
                duration: Math.max(0, Number(cue.endTime || 0) - Number(cue.startTime || 0)),
                text
              });
            }

            if (lines.length === 0) {
              return { error: 'textTrack cues parsed to empty lines', lines: null };
            }
            return { error: null, lines };
          } catch (e) {
            return { error: e.message || String(e), lines: null };
          }
        },
        args: [liveCaptionUrl]
      });

      const textTrackLines = textTrackResult?.[0]?.result?.lines;
      const textTrackError = textTrackResult?.[0]?.result?.error || 'none';
      if (textTrackLines && textTrackLines.length > 0) {
        console.log('[YouTubeExtractor] textTracks success:', textTrackLines.length, 'lines');
        return textTrackLines;
      }
      console.log('[YouTubeExtractor] textTracks fallback failed:', textTrackError);

      // Strategy 1: InnerTube get_transcript API (from page context)
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (vid) => {
          try {
            // Get config from page
            const getConfig = (key) => {
              if (typeof ytcfg !== 'undefined' && ytcfg.get) return ytcfg.get(key);
              return null;
            };

            const apiKey = getConfig('INNERTUBE_API_KEY');
            const innertubeContext = getConfig('INNERTUBE_CONTEXT') || null;
            const clientName = getConfig('INNERTUBE_CLIENT_NAME')
              || innertubeContext?.client?.clientName
              || 'WEB';
            const clientVersion = getConfig('INNERTUBE_CLIENT_VERSION')
              || innertubeContext?.client?.clientVersion
              || '2.20250101.00.00';
            const clientNameHeader = getConfig('INNERTUBE_CONTEXT_CLIENT_NAME') || clientName;
            const clientVersionHeader = getConfig('INNERTUBE_CONTEXT_CLIENT_VERSION') || clientVersion;
            const visitorData = getConfig('VISITOR_DATA');
            const sessionIndex = getConfig('SESSION_INDEX');
            const delegatedSessionId = getConfig('DELEGATED_SESSION_ID');

            // If no video ID passed, try to get from page
            let videoId = vid;
            if (!videoId) {
              videoId = new URL(window.location.href).searchParams.get('v');
            }
            if (!videoId) {
              return { error: 'No video ID', data: null };
            }

            const encodeLegacyVideoParams = (id) => {
              const encoder = new TextEncoder();
              const vidBytes = encoder.encode(id);
              const inner = new Uint8Array(2 + vidBytes.length);
              inner[0] = 0x0a;
              inner[1] = vidBytes.length;
              inner.set(vidBytes, 2);
              const outer = new Uint8Array(2 + inner.length);
              outer[0] = 0x0a;
              outer[1] = inner.length;
              outer.set(inner, 2);
              return btoa(String.fromCharCode(...outer));
            };

            const requestContext = innertubeContext
              ? {
                ...innertubeContext,
                client: {
                  ...innertubeContext.client,
                  visitorData: visitorData || innertubeContext.client?.visitorData
                },
                user: {
                  ...(innertubeContext.user || {}),
                  ...(delegatedSessionId ? { onBehalfOfUser: delegatedSessionId } : {})
                }
              }
              : {
                client: {
                  clientName: String(clientName),
                  clientVersion: clientVersion,
                  visitorData: visitorData || undefined
                }
              };

            const extractParamsFromGraph = (roots, sourcePrefix, maxSteps = 30000) => {
              const queue = roots.filter(Boolean);
              const seen = new Set();
              let steps = 0;

              while (queue.length > 0 && steps < maxSteps) {
                const node = queue.shift();
                steps += 1;
                if (!node || typeof node !== 'object' || seen.has(node)) continue;
                seen.add(node);

                const apiUrl = node.commandMetadata?.webCommandMetadata?.apiUrl || '';
                if (node.getTranscriptEndpoint?.params) {
                  return {
                    params: node.getTranscriptEndpoint.params,
                    source: `${sourcePrefix}.getTranscriptEndpoint.params`
                  };
                }
                if (node.continuationEndpoint?.getTranscriptEndpoint?.params) {
                  return {
                    params: node.continuationEndpoint.getTranscriptEndpoint.params,
                    source: `${sourcePrefix}.continuationEndpoint.getTranscriptEndpoint.params`
                  };
                }
                if (typeof node.params === 'string' && (
                  node.getTranscriptEndpoint
                  || (typeof apiUrl === 'string' && apiUrl.includes('get_transcript'))
                )) {
                  return {
                    params: node.params,
                    source: `${sourcePrefix}.params+endpoint`
                  };
                }

                for (const key of Object.keys(node)) {
                  const child = node[key];
                  if (child && typeof child === 'object') queue.push(child);
                }
              }

              return { params: null, source: `${sourcePrefix}.not_found` };
            };

            const findTranscriptParams = async () => {
              // Priority 1: current page data graph
              const roots = [
                window.ytInitialData,
                window.ytInitialPlayerResponse,
                window.ytplayer?.config,
                window.ytplayer?.bootstrapWebPlayerContextConfig,
                document.querySelector('ytd-watch-flexy')?.data
              ];
              const local = extractParamsFromGraph(roots, 'page', 40000);
              if (local.params) return local;

              // Priority 2: query /youtubei/v1/next to obtain transcript endpoint params
              // from current watch response payload.
              try {
                const nextUrl = apiKey
                  ? `/youtubei/v1/next?key=${apiKey}`
                  : '/youtubei/v1/next';
                const nextResp = await fetch(nextUrl, {
                  method: 'POST',
                  credentials: 'same-origin',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Youtube-Client-Name': String(clientNameHeader),
                    'X-Youtube-Client-Version': String(clientVersionHeader),
                    ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
                    ...(sessionIndex !== null && sessionIndex !== undefined
                      ? { 'X-Goog-AuthUser': String(sessionIndex) }
                      : {}),
                    ...(delegatedSessionId ? { 'X-Goog-PageId': String(delegatedSessionId) } : {}),
                    'X-Origin': location.origin
                  },
                  body: JSON.stringify({
                    context: requestContext,
                    videoId: videoId
                  })
                });

                if (nextResp.ok) {
                  const nextData = await nextResp.json();
                  const nextLookup = extractParamsFromGraph([nextData], 'next', 60000);
                  if (nextLookup.params) return nextLookup;
                } else {
                  console.log('[YT-PageCtx] next API status:', nextResp.status);
                }
              } catch (e) {
                console.log('[YT-PageCtx] next API exception:', e?.message || String(e));
              }

              return { params: null, source: 'not_found' };
            };

            const paramsLookup = await findTranscriptParams();
            const transcriptParams = paramsLookup?.params || encodeLegacyVideoParams(videoId);
            const paramsSource = paramsLookup?.params ? paramsLookup.source : 'legacy_encoded_video_id';

            console.log('[YT-PageCtx] get_transcript: videoId=', videoId,
              'apiKey=', apiKey ? 'found' : 'missing',
              'client=', clientName, clientVersion,
              'paramsSource=', paramsSource);

            const url = apiKey
              ? `/youtubei/v1/get_transcript?key=${apiKey}`
              : '/youtubei/v1/get_transcript';

            const postGetTranscript = async (paramsValue) => fetch(url, {
              method: 'POST',
              credentials: 'same-origin',
              headers: {
                'Content-Type': 'application/json',
                'X-Youtube-Client-Name': String(clientNameHeader),
                'X-Youtube-Client-Version': String(clientVersionHeader),
                ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
                ...(sessionIndex !== null && sessionIndex !== undefined
                  ? { 'X-Goog-AuthUser': String(sessionIndex) }
                  : {}),
                ...(delegatedSessionId ? { 'X-Goog-PageId': String(delegatedSessionId) } : {}),
                'X-Origin': location.origin
              },
              body: JSON.stringify({
                context: requestContext,
                videoId: videoId,
                params: paramsValue
              })
            });

            let resp = await postGetTranscript(transcriptParams);
            let usedParamsSource = paramsSource;

            console.log('[YT-PageCtx] get_transcript response:', resp.status);

            if (!resp.ok) {
              const errText = await resp.text();
              console.log('[YT-PageCtx] get_transcript error body:', errText.substring(0, 200));

              // Fallback: if discovered params fail with 400, retry once with legacy format.
              if (resp.status === 400 && paramsSource !== 'legacy_encoded_video_id') {
                const retryResp = await postGetTranscript(encodeLegacyVideoParams(videoId));
                if (retryResp.ok) {
                  const retryData = await retryResp.json();
                  return {
                    error: null,
                    data: retryData,
                    meta: { paramsSource: `legacy_retry_after_${paramsSource}` }
                  };
                }
                const retryErr = await retryResp.text();
                return {
                  error: 'HTTP 400',
                  data: null,
                  meta: {
                    paramsSource: paramsSource,
                    errorBodySnippet: errText.substring(0, 200),
                    retryStatus: retryResp.status,
                    retryErrorBodySnippet: retryErr.substring(0, 200)
                  }
                };
              }

              return {
                error: 'HTTP ' + resp.status,
                data: null,
                meta: {
                  paramsSource: paramsSource,
                  errorBodySnippet: errText.substring(0, 200)
                }
              };
            }

            const data = await resp.json();
            console.log('[YT-PageCtx] get_transcript keys:', Object.keys(data).join(', '));
            return { error: null, data, meta: { paramsSource: usedParamsSource } };
          } catch (e) {
            console.error('[YT-PageCtx] get_transcript exception:', e);
            return { error: e.message, data: null };
          }
        },
        args: [effectiveVideoId]
      });

      const result = results?.[0]?.result;
      const paramsSource = result?.meta?.paramsSource || 'unknown';
      const strategy1Error = result?.error || 'none';
      const strategy1Body = (result?.meta?.errorBodySnippet || 'none')
        .replace(/\s+/g, ' ')
        .slice(0, 120);
      const strategy1RetryStatus = result?.meta?.retryStatus || 'none';

      if (result?.data) {
        const transcript = this._parseGetTranscriptResponse(result.data);
        if (transcript && transcript.length > 0) {
          console.log('[YouTubeExtractor] get_transcript success:', transcript.length, 'lines');
          return transcript;
        }
        console.log('[YouTubeExtractor] get_transcript returned data but parsing failed');
      } else {
        console.log('[YouTubeExtractor] get_transcript failed:', result?.error);
      }

      // Strategy 1.5: Refresh caption track URL via youtubei/v1/player, then fetch timedtext.
      console.log('[YouTubeExtractor] Trying player API caption refresh...');
      const playerRefreshResult = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (vid, preferredUrl) => {
          try {
            const getConfig = (key) => {
              if (typeof ytcfg !== 'undefined' && ytcfg.get) return ytcfg.get(key);
              return null;
            };
            const apiKey = getConfig('INNERTUBE_API_KEY');
            const ctx = getConfig('INNERTUBE_CONTEXT') || {
              client: {
                clientName: getConfig('INNERTUBE_CLIENT_NAME') || 'WEB',
                clientVersion: getConfig('INNERTUBE_CLIENT_VERSION') || '2.20250101.00.00',
                visitorData: getConfig('VISITOR_DATA') || undefined
              }
            };
            const clientNameHeader = String(getConfig('INNERTUBE_CONTEXT_CLIENT_NAME') || ctx.client?.clientName || 'WEB');
            const clientVersionHeader = String(getConfig('INNERTUBE_CONTEXT_CLIENT_VERSION') || ctx.client?.clientVersion || '2.20250101.00.00');
            const visitorData = getConfig('VISITOR_DATA');

            const wanted = new URL(preferredUrl, location.href);
            const wantedLang = wanted.searchParams.get('lang');
            const wantedKind = wanted.searchParams.get('kind') || '';
            const wantedName = wanted.searchParams.get('name') || '';

            const playerUrl = apiKey
              ? `/youtubei/v1/player?key=${apiKey}`
              : '/youtubei/v1/player';
            const playerResp = await fetch(playerUrl, {
              method: 'POST',
              credentials: 'same-origin',
              headers: {
                'Content-Type': 'application/json',
                'X-Youtube-Client-Name': clientNameHeader,
                'X-Youtube-Client-Version': clientVersionHeader,
                ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
                'X-Origin': location.origin
              },
              body: JSON.stringify({
                context: ctx,
                videoId: vid
              })
            });
            if (!playerResp.ok) {
              return { error: `player_api_http_${playerResp.status}`, text: null, noTracks: false };
            }

            const playerData = await playerResp.json();
            const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            if (!Array.isArray(tracks) || tracks.length === 0) {
              return {
                error: 'player_api_no_caption_tracks',
                text: null,
                noTracks: true
              };
            }

            const matched = tracks.find(t =>
              t?.baseUrl
              && (!wantedLang || t.languageCode === wantedLang)
              && (t.kind || '') === wantedKind
              && ((t.vssId || '').includes(wantedName) || !wantedName)
            ) || tracks.find(t =>
              t?.baseUrl && (!wantedLang || t.languageCode === wantedLang)
            ) || tracks.find(t => t?.baseUrl);

            if (!matched?.baseUrl) {
              return { error: 'player_api_no_matched_track', text: null, noTracks: false };
            }

            const buildUrl = (base, fmt) => {
              const u = new URL(base, location.href);
              if (fmt) u.searchParams.set('fmt', fmt);
              return u.toString();
            };
            const candidates = [
              matched.baseUrl,
              buildUrl(matched.baseUrl, 'json3'),
              buildUrl(matched.baseUrl, 'srv3'),
              buildUrl(matched.baseUrl, 'vtt')
            ];

            for (const candidate of candidates) {
              const resp = await fetch(candidate, { credentials: 'same-origin' });
              if (!resp.ok) continue;
              const text = await resp.text();
              if (text && text.trim()) return { error: null, text, usedUrl: candidate, noTracks: false };
            }

            return { error: 'player_api_timedtext_empty', text: null, noTracks: false };
          } catch (e) {
            return { error: e.message || String(e), text: null, noTracks: false };
          }
        },
        args: [effectiveVideoId, liveCaptionUrl]
      });

      const playerRefreshText = playerRefreshResult?.[0]?.result?.text;
      const playerRefreshError = playerRefreshResult?.[0]?.result?.error || 'none';
      const playerRefreshNoTracks = Boolean(playerRefreshResult?.[0]?.result?.noTracks);
      if (playerRefreshText && playerRefreshText.trim().length > 0) {
        const parsed = this._parseTimedTextPayload(playerRefreshText);
        if (parsed && parsed.length > 0) {
          return parsed;
        }
      }
      if (playerRefreshNoTracks) {
        const noTracksMsg = [
          '[YouTubeExtractor] 当前视频无可访问字幕轨道 (WEB client)',
          `videoId=${effectiveVideoId || 'N/A'}`,
          'reason=player_api_no_caption_tracks'
        ].join('; ');
        console.warn(noTracksMsg, '; fallback=trying_android_client');
      }
      console.log('[YouTubeExtractor] player refresh strategy failed:', playerRefreshError);

      // Strategy 1.7: ANDROID InnerTube client from page context (MAIN world).
      // YouTube's ANDROID client often returns caption tracks that the WEB client omits.
      // This is the approach used by youtube-transcript-api (Python) and other tools.
      console.log('[YouTubeExtractor] Trying ANDROID client fallback...');
      try {
        const androidTracks = await this._fetchCaptionTracksViaAndroidClient(effectiveVideoId, tabId);
        if (androidTracks && androidTracks.length > 0) {
          console.log('[YouTubeExtractor] ANDROID client returned', androidTracks.length, 'tracks');
          // Try to find a matching track and fetch its timedtext
          const wantedLang = (() => {
            try { return new URL(liveCaptionUrl).searchParams.get('lang'); } catch { return null; }
          })();
          const wantedKind = (() => {
            try { return new URL(liveCaptionUrl).searchParams.get('kind') || ''; } catch { return ''; }
          })();

          const matched = androidTracks.find(t =>
            t.url && (!wantedLang || t.code === wantedLang) && (t.kind || '') === wantedKind
          ) || androidTracks.find(t =>
            t.url && (!wantedLang || t.code === wantedLang)
          ) || androidTracks.find(t => t.url);

          if (matched?.url) {
            const androidCandidates = this._buildCaptionCandidates(matched.url);
            for (const candidate of androidCandidates) {
              try {
                const resp = await fetch(candidate, { credentials: 'include' });
                if (!resp.ok) continue;
                const text = await resp.text();
                if (text && text.trim()) {
                  const parsed = this._parseTimedTextPayload(text);
                  if (parsed && parsed.length > 0) {
                    console.log('[YouTubeExtractor] ANDROID client timedtext success:', parsed.length, 'lines');
                    return parsed;
                  }
                }
              } catch (e) {
                console.log('[YouTubeExtractor] ANDROID timedtext fetch error:', e?.message);
              }
            }
          }
        }
      } catch (e) {
        console.log('[YouTubeExtractor] ANDROID client strategy failed:', e?.message);
      }

      // Strategy 2: Direct caption URL fetch from page context (last resort)
      console.log('[YouTubeExtractor] Trying direct caption URL fetch...');
      const directResult = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (url) => {
          try {
            const buildUrl = (base, fmt) => {
              const u = new URL(base, location.href);
              if (fmt) u.searchParams.set('fmt', fmt);
              return u.toString();
            };

            const candidates = [
              url,
              buildUrl(url, 'json3'),
              buildUrl(url, 'srv3'),
              buildUrl(url, 'vtt')
            ];

            for (const candidate of candidates) {
              const resp = await fetch(candidate);
              if (!resp.ok) {
                console.log('[YT-PageCtx] Direct fetch failed:', resp.status, candidate);
                continue;
              }
              const text = await resp.text();
              console.log('[YT-PageCtx] Direct fetch success:',
                text.length, 'bytes', candidate);
              if (text && text.trim().length > 0) {
                return { error: null, text, usedUrl: candidate };
              }
            }

            return { error: 'All direct fetch attempts failed', text: '' };
          } catch (e) {
            return { error: e.message, text: '' };
          }
        },
        args: [liveCaptionUrl]
      });

      const dr = directResult?.[0]?.result;
      if (dr?.text && dr.text.length > 0) {
        const parsed = this._parseTimedTextPayload(dr.text);
        if (parsed && parsed.length > 0) {
          return parsed;
        }
      }

      console.log('[YouTubeExtractor] Direct strategy error:', dr?.error,
        'preview:', (dr?.text || '').substring(0, 120));

      // Strategy 3: Direct caption URL fetch from extension context.
      // This bypasses page-world constraints and uses extension host permissions.
      console.log('[YouTubeExtractor] Trying extension-context caption fetch...');
      const extCandidates = this._buildCaptionCandidates(liveCaptionUrl);
      for (const candidate of extCandidates) {
        try {
          const attempts = [
            { credentials: 'include', tag: 'include' },
            { credentials: 'omit', tag: 'omit' }
          ];
          let gotAnyResponse = false;

          for (const attempt of attempts) {
            const resp = await fetch(candidate, { credentials: attempt.credentials });
            if (!resp.ok) {
              console.log('[YouTubeExtractor] Extension fetch failed:',
                resp.status, candidate, `cred=${attempt.tag}`);
              continue;
            }
            gotAnyResponse = true;
            const text = await resp.text();
            console.log('[YouTubeExtractor] Extension fetch success:',
              text.length, 'bytes', candidate, `cred=${attempt.tag}`);
            const parsed = this._parseTimedTextPayload(text);
            if (parsed && parsed.length > 0) {
              return parsed;
            }
          }

          if (!gotAnyResponse) {
            continue;
          }
        } catch (e) {
          console.log('[YouTubeExtractor] Extension fetch exception:',
            e?.message || String(e), candidate);
        }
      }

      // Strategy 4: Rebuild canonical timedtext URLs (without volatile tokens).
      // This can still work when baseUrl expire/signature params are stale.
      console.log('[YouTubeExtractor] Trying canonical timedtext fallback...');
      const canonicalCandidates = this._buildCanonicalTimedTextCandidates(
        liveCaptionUrl || captionUrl,
        effectiveVideoId
      );
      for (const candidate of canonicalCandidates) {
        try {
          const resp = await fetch(candidate, { credentials: 'include' });
          if (!resp.ok) {
            console.log('[YouTubeExtractor] Canonical fetch failed:', resp.status, candidate);
            continue;
          }
          const text = await resp.text();
          console.log('[YouTubeExtractor] Canonical fetch success:', text.length, 'bytes', candidate);
          const parsed = this._parseTimedTextPayload(text);
          if (parsed && parsed.length > 0) {
            return parsed;
          }
        } catch (e) {
          console.log('[YouTubeExtractor] Canonical fetch exception:',
            e?.message || String(e), candidate);
        }
      }

      const failureSummary = [
        `requestedVideoId=${requestedVideoId || 'N/A'}`,
        `currentVideoId=${effectiveVideoId || 'N/A'}`,
        `refreshNoTracks=${refreshNoTracks}`,
        `refreshReason=${refreshInfo?.reason || 'none'}`,
        `liveCaptionUrl=${(liveCaptionUrl || '').slice(0, 220)}`,
        `inPageError=${inPageError}`,
        `textTrackError=${textTrackError}`,
        `paramsSource=${paramsSource}`,
        `strategy1Error=${strategy1Error}`,
        `strategy1Body=${strategy1Body}`,
        `strategy1RetryStatus=${strategy1RetryStatus}`,
        `playerRefreshError=${playerRefreshError}`,
        `playerRefreshNoTracks=${playerRefreshNoTracks}`,
        `strategy2Error=${dr?.error || 'none'}`,
        `extCandidates=${extCandidates.length}`,
        `canonicalCandidates=${canonicalCandidates.length}`
      ].join('; ');
      console.error('[YouTubeExtractor] All strategies failed:', failureSummary);
      throw new Error(`[YouTubeExtractor] All strategies failed: ${failureSummary}`);
    } catch (e) {
      console.error('[YouTubeExtractor] getTranscript failed:', e);
      throw e;
    }
  },

  // Parse InnerTube get_transcript response
  _parseGetTranscriptResponse(data) {
    try {
      const parseFromAction = (action) => {
        const cueGroups = action?.updateEngagementPanelAction?.content
          ?.transcriptRenderer?.body?.transcriptBodyRenderer?.cueGroups;
        if (cueGroups) return this._parseCueGroups(cueGroups);

        const segments = action?.updateEngagementPanelAction?.content
          ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer
          ?.body?.transcriptSegmentListRenderer?.initialSegments;
        if (segments) return this._parseTranscriptSegments(segments);

        return null;
      };

      const actions = data?.actions;
      if (Array.isArray(actions)) {
        for (const action of actions) {
          const parsed = parseFromAction(action);
          if (parsed && parsed.length > 0) return parsed;
        }
      }

      // Some responses put transcript segments in continuationContents.
      const continuationSegments = data?.continuationContents
        ?.transcriptContinuation?.content?.transcriptSearchPanelRenderer
        ?.body?.transcriptSegmentListRenderer?.initialSegments;
      if (continuationSegments) {
        const parsed = this._parseTranscriptSegments(continuationSegments);
        if (parsed && parsed.length > 0) return parsed;
      }

      // Legacy/alternative direct body path.
      const directCueGroups = data?.body?.transcriptBodyRenderer?.cueGroups;
      if (directCueGroups) {
        const parsed = this._parseCueGroups(directCueGroups);
        if (parsed && parsed.length > 0) return parsed;
      }

      // Log structure for debugging
      console.log('[YouTubeExtractor] get_transcript structure:',
        JSON.stringify(data).substring(0, 500));
      return null;
    } catch (e) {
      console.error('[YouTubeExtractor] _parseGetTranscriptResponse failed:', e);
      return null;
    }
  },

  _parseCueGroups(cueGroups) {
    return cueGroups.map(group => {
      const cue = group.transcriptCueGroupRenderer?.cues?.[0]?.transcriptCueRenderer;
      if (!cue) return null;
      return {
        start: parseInt(cue.startOffsetMs || '0', 10) / 1000,
        duration: parseInt(cue.durationMs || '0', 10) / 1000,
        text: cue.cue?.simpleText || cue.cue?.runs?.map(r => r.text).join('') || ''
      };
    }).filter(line => line && line.text.trim());
  },

  _parseTranscriptSegments(segments) {
    return segments.map(seg => {
      const r = seg?.transcriptSegmentRenderer;
      if (!r) return null;
      const text = r.snippet?.runs?.map(x => x.text).join('')
        || r.snippet?.simpleText
        || '';
      const startMs = parseInt(r.startMs || '0', 10);
      const endMs = parseInt(r.endMs || String(startMs), 10);
      return {
        start: startMs / 1000,
        duration: Math.max(0, (endMs - startMs) / 1000),
        text
      };
    }).filter(line => line && line.text.trim());
  },

  parseJSON3(jsonText) {
    try {
      const sanitized = jsonText.replace(/^\uFEFF/, '').replace(/^\)\]\}'\s*/, '');
      const data = JSON.parse(sanitized);

      const lines = [];
      if (Array.isArray(data.events)) {
        for (const event of data.events) {
          if (!event.segs) continue;
          const start = (event.tStartMs || 0) / 1000;
          const duration = (event.dDurationMs || 0) / 1000;
          const text = event.segs.map(s => s.utf8 || '').join('').trim();
          if (text && text !== '\n') {
            lines.push({ start, duration, text });
          }
        }
      } else if (Array.isArray(data.cues)) {
        for (const cue of data.cues) {
          const start = parseFloat(cue.startOffsetMs || cue.start || 0) / 1000;
          const duration = parseFloat(cue.durationMs || cue.dur || 0) / 1000;
          const text = (cue.cue?.simpleText
            || cue.cue?.runs?.map(r => r.text).join('')
            || cue.payload
            || cue.text
            || '').trim();
          if (text) {
            lines.push({ start, duration, text });
          }
        }
      } else if (data?.actions || data?.continuationContents || data?.body) {
        const fromInnerTube = this._parseGetTranscriptResponse(data);
        if (fromInnerTube && fromInnerTube.length > 0) {
          return fromInnerTube;
        }
      }

      return lines.length > 0 ? lines : null;
    } catch (e) {
      console.error('[YouTubeExtractor] JSON3 parse failed:', e);
      return null;
    }
  },

  parseXML(xmlText) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'text/xml');
      const textElements = doc.querySelectorAll('text');

      const lines = [];
      if (textElements.length > 0) {
        for (const el of textElements) {
          const start = parseFloat(el.getAttribute('start'));
          const duration = parseFloat(el.getAttribute('dur') || '0');
          const text = this._decodeHtml(el.textContent || '').trim();
          if (text) {
            lines.push({ start, duration, text });
          }
        }
        return lines.length > 0 ? lines : null;
      }

      // srv3 format: <p t="1234" d="567"><s>...</s></p>
      const pElements = doc.querySelectorAll('p');
      for (const p of pElements) {
        const start = parseFloat(p.getAttribute('t') || '0') / 1000;
        const duration = parseFloat(p.getAttribute('d') || '0') / 1000;
        const sNodes = p.querySelectorAll('s');
        let text = '';
        if (sNodes.length > 0) {
          text = Array.from(sNodes).map(node => node.textContent || '').join('');
        } else {
          text = p.textContent || '';
        }
        text = this._decodeHtml(text).replace(/\s+/g, ' ').trim();
        if (text) {
          lines.push({ start, duration, text });
        }
      }

      return lines.length > 0 ? lines : null;
    } catch (e) {
      console.error('[YouTubeExtractor] XML parse failed:', e);
      return null;
    }
  },

  _decodeHtml(input) {
    const temp = document.createElement('div');
    temp.innerHTML = input;
    return temp.textContent || '';
  },

  _buildCaptionCandidates(baseUrl) {
    try {
      const make = (fmt) => {
        const u = new URL(baseUrl, 'https://www.youtube.com');
        if (fmt) u.searchParams.set('fmt', fmt);
        return u.toString();
      };
      const items = [
        make(null),
        make('json3'),
        make('srv3'),
        make('vtt')
      ];
      return Array.from(new Set(items));
    } catch {
      return [baseUrl];
    }
  },

  _buildCanonicalTimedTextCandidates(rawUrl, fallbackVideoId) {
    try {
      const src = new URL(rawUrl, 'https://www.youtube.com');
      const lang = src.searchParams.get('lang');
      const kind = src.searchParams.get('kind');
      const name = src.searchParams.get('name');
      const tlang = src.searchParams.get('tlang');
      const v = src.searchParams.get('v') || fallbackVideoId || '';

      if (!lang || !v) return [];

      const make = (fmt) => {
        const u = new URL('https://www.youtube.com/api/timedtext');
        u.searchParams.set('v', v);
        u.searchParams.set('lang', lang);
        if (kind) u.searchParams.set('kind', kind);
        if (name) u.searchParams.set('name', name);
        if (tlang) u.searchParams.set('tlang', tlang);
        if (fmt) u.searchParams.set('fmt', fmt);
        return u.toString();
      };

      return Array.from(new Set([
        make(null),
        make('json3'),
        make('srv3'),
        make('vtt')
      ]));
    } catch {
      return [];
    }
  },

  _parseTimedTextPayload(rawText) {
    const text = String(rawText || '')
      .replace(/^\uFEFF/, '')
      .trim();
    if (!text) return null;

    // Try JSON first (with XSSI/BOM tolerance)
    if (text.startsWith('{') || text.startsWith('[') || text.startsWith(')]}\'')) {
      const fromJson = this.parseJSON3(text);
      if (fromJson && fromJson.length > 0) return fromJson;
    }

    if (text.startsWith('<')) {
      const fromXml = this.parseXML(text);
      if (fromXml && fromXml.length > 0) return fromXml;
    }

    if (/^WEBVTT/i.test(text) || text.includes('-->')) {
      const fromVtt = this.parseVTT(text);
      if (fromVtt && fromVtt.length > 0) return fromVtt;
    }

    return null;
  },

  parseVTT(vttText) {
    try {
      const lines = [];
      const blocks = vttText
        .replace(/\r/g, '')
        .split(/\n\n+/)
        .map(b => b.trim())
        .filter(Boolean);

      for (const block of blocks) {
        if (block.startsWith('WEBVTT')) continue;
        const rowLines = block.split('\n').map(l => l.trim()).filter(Boolean);
        if (rowLines.length < 2) continue;

        const timeLineIndex = rowLines[0].includes('-->') ? 0 : 1;
        const timeLine = rowLines[timeLineIndex];
        if (!timeLine || !timeLine.includes('-->')) continue;

        const [startRaw, endRaw] = timeLine.split('-->').map(s => s.trim().split(' ')[0]);
        const parseVttTime = (s) => {
          const parts = s.split(':');
          if (parts.length === 3) {
            return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2].replace(',', '.'));
          }
          if (parts.length === 2) {
            return parseFloat(parts[0]) * 60 + parseFloat(parts[1].replace(',', '.'));
          }
          return parseFloat(s.replace(',', '.')) || 0;
        };

        const start = parseVttTime(startRaw);
        const end = parseVttTime(endRaw);
        const text = rowLines.slice(timeLineIndex + 1).join(' ').trim();
        if (!text) continue;

        lines.push({
          start,
          duration: Math.max(0, end - start),
          text
        });
      }

      return lines.length > 0 ? lines : null;
    } catch (e) {
      console.error('[YouTubeExtractor] VTT parse failed:', e);
      return null;
    }
  },

  // Fetch caption tracks using ANDROID InnerTube client from page context (MAIN world).
  // Must run in MAIN world so the request Origin is www.youtube.com (not chrome-extension://).
  // The ANDROID client often returns caption tracks that the WEB client omits.
  // Based on the approach used by youtube-transcript-api (Python):
  //   clientName: "ANDROID", clientVersion: "20.10.38"
  // Reference: https://github.com/jdepoix/youtube-transcript-api
  async _fetchCaptionTracksViaAndroidClient(videoId, tabId) {
    if (!videoId || !tabId) return null;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (vid) => {
          try {
            // Use page-context fetch so Origin = www.youtube.com.
            // Try with page API key first, fall back to keyless.
            const getConfig = (key) => {
              if (typeof ytcfg !== 'undefined' && ytcfg.get) return ytcfg.get(key);
              return null;
            };
            const apiKey = getConfig('INNERTUBE_API_KEY');
            const visitorData = getConfig('VISITOR_DATA');

            const playerUrl = apiKey
              ? `/youtubei/v1/player?key=${apiKey}&prettyPrint=false`
              : '/youtubei/v1/player?prettyPrint=false';

            const resp = await fetch(playerUrl, {
              method: 'POST',
              credentials: 'same-origin',
              headers: {
                'Content-Type': 'application/json',
                'X-Youtube-Client-Name': '3',
                'X-Youtube-Client-Version': '20.10.38',
                ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
                'X-Origin': location.origin
              },
              body: JSON.stringify({
                context: {
                  client: {
                    clientName: 'ANDROID',
                    clientVersion: '20.10.38',
                    androidSdkVersion: 30,
                    hl: navigator.language || 'en',
                    gl: 'US'
                  }
                },
                videoId: vid
              })
            });

            if (!resp.ok) {
              return { error: `http_${resp.status}`, tracks: null };
            }

            const data = await resp.json();
            const captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
              return { error: 'no_tracks', tracks: null };
            }

            const tracks = [];
            const unique = new Set();
            for (const t of captionTracks) {
              const code = t?.languageCode || '';
              const baseUrl = t?.baseUrl || '';
              const kind = t?.kind || '';
              if (!code || !baseUrl) continue;
              const dedupeKey = `${code}|${kind}`;
              if (unique.has(dedupeKey)) continue;
              unique.add(dedupeKey);
              tracks.push({
                code,
                name: t.name?.simpleText || t.name?.runs?.[0]?.text || code,
                url: baseUrl,
                kind,
                isAutoGenerated: kind === 'asr'
              });
            }

            return { error: null, tracks: tracks.length > 0 ? tracks : null };
          } catch (e) {
            return { error: e?.message || String(e), tracks: null };
          }
        },
        args: [videoId]
      });

      const result = results?.[0]?.result;
      if (result?.error) {
        console.log('[YouTubeExtractor] ANDROID player API:', result.error);
      }
      return result?.tracks || null;
    } catch (e) {
      console.error('[YouTubeExtractor] ANDROID client exception:', e?.message || String(e));
      return null;
    }
  }
};
