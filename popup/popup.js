// Popup Script - All extraction logic runs HERE in extension context
// No content scripts needed. Uses fetch() with host_permissions.

(function () {
  'use strict';

  // State
  let currentTranscript = [];
  let filteredTranscript = [];
  let videoTitle = '';
  let currentPlatform = '';
  let currentTabId = null;
  let currentTabUrl = '';
  let currentLanguages = [];

  const HELPER_BASE_DEFAULT = 'http://127.0.0.1:8765';

  // All available extractors (loaded via script tags in popup.html)
  const extractors = [YouTubeExtractor, BilibiliExtractor];

  // DOM elements
  const platformBadge = document.getElementById('platformBadge');
  const languageSelect = document.getElementById('languageSelect');
  const extractBtn = document.getElementById('extractBtn');
  const searchInput = document.getElementById('searchInput');
  const statusArea = document.getElementById('statusArea');
  const transcriptArea = document.getElementById('transcriptArea');
  const transcriptContent = document.getElementById('transcriptContent');
  const lineCount = document.getElementById('lineCount');
  const copyBtn = document.getElementById('copyBtn');
  const exportTxtBtn = document.getElementById('exportTxtBtn');
  const exportMdBtn = document.getElementById('exportMdBtn');
  const helperUrlInput = document.getElementById('helperUrlInput');
  const helperExtractBtn = document.getElementById('helperExtractBtn');
  const helperAudioBtn = document.getElementById('helperAudioBtn');
  const audioLinkRow = document.getElementById('audioLinkRow');
  const audioLinkInput = document.getElementById('audioLinkInput');
  const copyAudioBtn = document.getElementById('copyAudioBtn');

  // Initialize
  init();

  async function init() {
    // Event listeners
    extractBtn.addEventListener('click', extractTranscript);
    searchInput.addEventListener('input', handleSearch);
    copyBtn.addEventListener('click', copyToClipboard);
    exportTxtBtn.addEventListener('click', () => exportFile('txt'));
    exportMdBtn.addEventListener('click', () => exportFile('md'));
    helperExtractBtn.addEventListener('click', extractViaLocalHelper);
    helperAudioBtn.addEventListener('click', fetchAudioLinkViaLocalHelper);
    copyAudioBtn.addEventListener('click', copyAudioLink);
    audioLinkRow.classList.add('hidden');

    const savedHelperUrl = localStorage.getItem('helperBaseUrl');
    if (savedHelperUrl) {
      helperUrlInput.value = savedHelperUrl;
    }
    helperUrlInput.addEventListener('change', () => {
      localStorage.setItem('helperBaseUrl', normalizeHelperBaseUrl(helperUrlInput.value));
      helperUrlInput.value = normalizeHelperBaseUrl(helperUrlInput.value);
    });

    // Get current tab info
    setStatus('Detecting platform...', 'loading');

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0]) {
        platformBadge.textContent = 'Error';
        setStatus('Cannot access current tab', 'error');
        return;
      }

      currentTabId = tabs[0].id;
      currentTabUrl = tabs[0].url;
      videoTitle = tabs[0].title || '';

      // Detect platform from URL
      const extractor = getExtractor(currentTabUrl);
      if (!extractor) {
        platformBadge.textContent = 'Unsupported';
        setStatus('Current page is not a supported video site (YouTube, Bilibili)', 'error');
        return;
      }

      currentPlatform = extractor.name;
      platformBadge.textContent = extractor.name;
      setStatus('Fetching subtitle languages...', 'loading');

      // Load available languages with retry:
      // watch pages can take a short time before caption metadata is populated.
      const languages = await loadLanguagesWithRetry(extractor);
      populateLanguages(languages);

    } catch (e) {
      platformBadge.textContent = 'Error';
      setStatus('Initialization failed: ' + e.message, 'error');
    }
  }

  function getExtractor(url) {
    for (const ext of extractors) {
      if (ext.canHandle(url)) return ext;
    }
    return null;
  }

  async function loadLanguagesWithRetry(extractor) {
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const languages = await extractor.getAvailableLanguages(currentTabUrl, currentTabId);
      if (languages && languages.length > 0) {
        return languages;
      }
      if (attempt < maxAttempts) {
        setStatus(`Loading tracks... (${attempt}/${maxAttempts})`, 'loading');
        await sleep(700 * attempt);
      }
    }
    return [];
  }

  function populateLanguages(languages) {
    currentLanguages = Array.isArray(languages) ? [...languages] : [];
    languageSelect.innerHTML = '';

    if (!languages || languages.length === 0) {
      languageSelect.innerHTML = '<option value="">No subtitles</option>';
      languageSelect.disabled = true;
      setStatus('No subtitles available. Try Local Helper below.', 'error');
      return;
    }

    languages.forEach((lang, i) => {
      const option = document.createElement('option');
      option.value = lang.url;
      const suffix = (lang.isAutoGenerated && !lang.nameAlreadyMarked) ? ' (Auto-generated)' : '';
      option.textContent = lang.name + suffix;
      if (i === 0) option.selected = true;
      languageSelect.appendChild(option);
    });

    languageSelect.disabled = false;
    setStatus(`Found ${languages.length} tracks. Click Extract`, '');
  }

  async function extractTranscript() {
    const selectedUrl = languageSelect.value;
    if (!selectedUrl) {
      setStatus('Please select a language first', 'error');
      return;
    }

    const extractor = getExtractor(currentTabUrl);
    if (!extractor) return;

    extractBtn.disabled = true;
    extractBtn.textContent = 'Extracting...';
    setStatus('<span class="loading-spinner"></span>Extracting subtitles data...', 'loading');
    transcriptArea.style.display = 'none';

    try {
      // YouTube needs tabId for page context; Bilibili uses direct fetch
      const transcript = await extractor.getTranscript(selectedUrl, currentTabId);

      extractBtn.disabled = false;
      extractBtn.textContent = 'Extract';

      if (!transcript || transcript.length === 0) {
        setStatus('No valid subtitle data found for this video', 'error');
        return;
      }

      applyTranscript(transcript);
      setStatus('');

    } catch (e) {
      extractBtn.disabled = false;
      extractBtn.textContent = 'Extract';
      setStatus('Extraction failed: ' + e.message, 'error');
    }
  }

  async function extractViaLocalHelper() {
    if (!currentTabUrl) {
      setStatus('Cannot get current page URL', 'error');
      return;
    }

    const previousText = helperExtractBtn.textContent;
    helperExtractBtn.disabled = true;
    helperExtractBtn.textContent = 'Parsing...';
    setStatus('<span class="loading-spinner"></span>Local helper parsing subtitles...', 'loading');

    try {
      const preferredLang = findSelectedLanguageCode();
      const data = await callLocalHelper('/transcript', {
        url: currentTabUrl,
        lang: preferredLang
      });

      if (!data.success) {
        throw new Error(data.error || 'Local helper failed');
      }

      if (data.audio_url) {
        audioLinkInput.value = data.audio_url;
        audioLinkRow.classList.remove('hidden');
      }

      if (!Array.isArray(data.lines) || data.lines.length === 0) {
        setStatus('Local helper found no subtitles. Try getting audio link.', 'error');
        return;
      }

      if (data.title) {
        videoTitle = data.title;
      }
      applyTranscript(data.lines);
      setStatus(`Local helper extracted ${data.lines.length} lines`, '');
    } catch (e) {
      setStatus('Local helper extraction failed: ' + e.message, 'error');
    } finally {
      helperExtractBtn.disabled = false;
      helperExtractBtn.textContent = previousText;
    }
  }

  async function fetchAudioLinkViaLocalHelper() {
    if (!currentTabUrl) {
      setStatus('Cannot get current page URL', 'error');
      return;
    }

    const previousText = helperAudioBtn.textContent;
    helperAudioBtn.disabled = true;
    helperAudioBtn.textContent = 'Getting...';
    setStatus('<span class="loading-spinner"></span>Local helper parsing audio link...', 'loading');

    try {
      const data = await callLocalHelper('/audio-link', { url: currentTabUrl });
      if (!data.success || !data.audio_url) {
        throw new Error(data.error || 'No audio link found');
      }
      audioLinkInput.value = data.audio_url;
      audioLinkRow.classList.remove('hidden');
      setStatus('Audio link generated. You can copy it now.', '');
    } catch (e) {
      setStatus('Failed to get audio link: ' + e.message, 'error');
    } finally {
      helperAudioBtn.disabled = false;
      helperAudioBtn.textContent = previousText;
    }
  }

  function copyAudioLink() {
    const url = (audioLinkInput.value || '').trim();
    if (!url) {
      setStatus('No audio link to copy', 'error');
      return;
    }
    navigator.clipboard.writeText(url).then(() => {
      copyAudioBtn.textContent = 'Copied';
      copyAudioBtn.classList.add('success');
      setTimeout(() => {
        copyAudioBtn.textContent = 'Copy';
        copyAudioBtn.classList.remove('success');
      }, 1500);
    }).catch(() => {
      setStatus('Copy failed', 'error');
    });
  }

  function findSelectedLanguageCode() {
    const selectedUrl = languageSelect.value;
    const selected = currentLanguages.find(x => x.url === selectedUrl);
    return selected?.code || '';
  }

  function applyTranscript(transcript) {
    currentTranscript = transcript;
    filteredTranscript = [...transcript];
    videoTitle = videoTitle
      .replace(/ - YouTube$/, '')
      .replace(/_哔哩哔哩_bilibili$/, '')
      .replace(/-哔哩哔哩$/, '')
      .trim();
    searchInput.disabled = false;
    searchInput.value = '';
    renderTranscript();
    transcriptArea.style.display = 'flex';
  }

  function renderTranscript(searchTerm) {
    transcriptContent.innerHTML = '';

    const lines = searchTerm ? filteredTranscript : currentTranscript;
    lineCount.textContent = `${lines.length} lines${searchTerm ? ' (filtered)' : ''}`;

    const fragment = document.createDocumentFragment();

    for (const line of lines) {
      const div = document.createElement('div');
      div.className = 'transcript-line';

      const ts = document.createElement('span');
      ts.className = 'timestamp';
      ts.textContent = formatTime(line.start);
      ts.addEventListener('click', () => seekTo(line.start));

      const text = document.createElement('span');
      text.className = 'line-text';

      if (searchTerm) {
        text.innerHTML = highlightText(line.text, searchTerm);
      } else {
        text.textContent = line.text;
      }

      div.appendChild(ts);
      div.appendChild(text);
      fragment.appendChild(div);
    }

    transcriptContent.appendChild(fragment);
  }

  // Seek video using chrome.scripting.executeScript (no content script needed)
  function seekTo(seconds) {
    if (!currentTabId) return;
    chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      world: 'MAIN',
      func: (time) => {
        const video = document.querySelector('video');
        if (video) {
          video.currentTime = time;
          video.play();
        }
      },
      args: [seconds]
    });
  }

  function handleSearch() {
    const term = searchInput.value.trim().toLowerCase();

    if (!term) {
      filteredTranscript = [...currentTranscript];
      renderTranscript();
      return;
    }

    filteredTranscript = currentTranscript.filter(line =>
      line.text.toLowerCase().includes(term)
    );
    renderTranscript(term);
  }

  function highlightText(text, term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }

  // Export functions
  function copyToClipboard() {
    const text = transcriptToPlainText();
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = 'Copied';
      copyBtn.classList.add('success');
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
        copyBtn.classList.remove('success');
      }, 2000);
    }).catch(() => {
      setStatus('Copy failed, please select manually', 'error');
    });
  }

  function exportFile(format) {
    let content, filename, mimeType;
    const safeTitle = (videoTitle || 'Transcript').replace(/[<>:"/\\|?*]/g, '_');

    if (format === 'txt') {
      content = transcriptToPlainText();
      filename = `${safeTitle}.txt`;
      mimeType = 'text/plain';
    } else if (format === 'md') {
      content = transcriptToMarkdown();
      filename = `${safeTitle}.md`;
      mimeType = 'text/markdown';
    }

    const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function transcriptToPlainText() {
    const source = filteredTranscript.length > 0 ? filteredTranscript : currentTranscript;
    const header = videoTitle ? `${videoTitle}\n${'='.repeat(40)}\n\n` : '';
    const lines = source.map(line =>
      `[${formatTime(line.start)}] ${line.text}`
    ).join('\n');
    return header + lines;
  }

  function transcriptToMarkdown() {
    const source = filteredTranscript.length > 0 ? filteredTranscript : currentTranscript;
    let md = '';

    if (videoTitle) {
      md += `# ${videoTitle}\n\n`;
      md += `> Platform: ${currentPlatform} | Extracted: ${new Date().toLocaleString()}\n\n`;
      md += `---\n\n`;
    }

    for (const line of source) {
      md += `**[${formatTime(line.start)}]** ${line.text}\n\n`;
    }

    return md;
  }

  // Utility functions
  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
      return `${pad(h)}:${pad(m)}:${pad(s)}`;
    }
    return `${pad(m)}:${pad(s)}`;
  }

  function pad(n) {
    return n.toString().padStart(2, '0');
  }

  function normalizeHelperBaseUrl(raw) {
    const value = (raw || '').trim();
    if (!value) return HELPER_BASE_DEFAULT;
    try {
      const u = new URL(value);
      return `${u.protocol}//${u.host}`;
    } catch {
      return HELPER_BASE_DEFAULT;
    }
  }

  async function callLocalHelper(path, payload) {
    const baseUrl = normalizeHelperBaseUrl(helperUrlInput.value);
    helperUrlInput.value = baseUrl;
    localStorage.setItem('helperBaseUrl', baseUrl);

    const resp = await fetch(baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} (Make sure local helper is running)`);
    }
    return resp.json();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function setStatus(html, type) {
    statusArea.innerHTML = html;
    statusArea.className = 'status' + (type ? ' ' + type : '');
  }
})();
