/**
 * Vidopick Chrome Extension - Content Script
 * Version: 9.0 (Simplified - No Custom Token Auth)
 */

const MIN_VIDS_REQUIRED = 5;

let config = {
  youtubeApiKey: '',
  firebaseConfig: null,
  openaiApiKey: '',
  editorName: 'manual',
  extensionApiKey: ''
};

// Cache of IDs we have verified exist/don't exist to avoid re-checking
let knownExistingIds = new Set();
let checkedIds = new Set();
let isConfigLoaded = false;

// --- INITIALIZATION ---

chrome.storage.sync.get(['youtubeApiKey', 'firebaseConfig', 'openaiApiKey', 'editorName', 'extensionApiKey'], (result) => {
  config = {
    youtubeApiKey: result.youtubeApiKey || '',
    firebaseConfig: result.firebaseConfig || null,
    openaiApiKey: result.openaiApiKey || '',
    editorName: result.editorName || 'manual',
    extensionApiKey: result.extensionApiKey || ''
  };
  
  if (config.youtubeApiKey && config.firebaseConfig && config.openaiApiKey && config.extensionApiKey) {
    isConfigLoaded = true;
    initializeExtension();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CONFIG_UPDATED') {
    config = message.config;
    isConfigLoaded = true;
    
    // Clear cache on config change to force re-check
    knownExistingIds.clear();
    checkedIds.clear();
    
    initializeExtension();
  }
});

function initializeExtension() {
  // Start the UI loop immediately
  scanAndCheck();

  let timeout = null;
  const observer = new MutationObserver(() => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      scanAndCheck();
    }, 700);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * CORE LOGIC: Scans page for IDs, Batches them, Checks existence, Updates UI
 */
async function scanAndCheck() {
  if (!isConfigLoaded || !config.firebaseConfig) return;

  // 1. Find all playlist IDs currently on screen
  const visibleIds = new Set();
  const allLinks = document.querySelectorAll('a[href*="list="]');
  
  allLinks.forEach(link => {
    const id = new URLSearchParams(new URL(link.href).search).get('list');
    if (id && id.length > 5) visibleIds.add(id);
  });

  // 2. Filter out IDs we've already checked (client-side cache)
  const idsToCheck = [...visibleIds].filter(id => !checkedIds.has(id));

  // 3. If we have new IDs, check them in a batch
  if (idsToCheck.length > 0) {
    // Mark as checked immediately to prevent duplicate requests while waiting
    idsToCheck.forEach(id => checkedIds.add(id));
    await checkIdsInBatch(idsToCheck);
  }

  // 4. Update UI (This applies badges to everything we know about)
  injectButtons();
}

/**
 * OPTIMIZED: Checks existence of specific IDs using batchGet
 * Cost: 1 Read per document found.
 * Bandwidth: Extremely low (uses field mask).
 */
async function checkIdsInBatch(ids) {
  try {
    const { projectId, apiKey } = config.firebaseConfig;
    const endpoint = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:batchGet?key=${apiKey}`;

    // Firestore batchGet allows max ~500 ids, but we process in smaller chunks to be safe
    const chunkSize = 50;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: chunk.map(id => 
            `projects/${projectId}/databases/(default)/documents/scannedPlaylists/${id}`
          ),
          mask: { fieldPaths: ["__name__"] }
        })
      });

      const data = await response.json();
      
      if (Array.isArray(data)) {
        data.forEach(item => {
          if (item.found) {
            const pathParts = item.found.name.split('/');
            const foundId = pathParts[pathParts.length - 1];
            knownExistingIds.add(foundId);
          }
        });
      }
    }
    
    injectButtons();

  } catch (error) {
    console.error("Vidopick: Error checking existence", error);
  }
}

// --- UI INJECTION ---

function injectButtons() {
  const allLinks = document.querySelectorAll('a[href*="list="]');
  
  allLinks.forEach((link) => {
    const href = link.getAttribute('href');
    if (!href.includes('/playlist?list=')) return;

    let container = link.closest('yt-lockup-view-model') || 
                    link.closest('ytd-grid-playlist-renderer') ||
                    link.closest('ytd-lockup-view-model') ||
                    link.closest('ytd-compact-playlist-renderer');

    if (!container) container = link.parentElement?.parentElement?.parentElement?.parentElement;
    if (!container) return;
    if (container.querySelector('.vidopick-element')) return;

    const playlistId = new URLSearchParams(new URL(link.href).search).get('list');
    if (!playlistId) return;

    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

    // Toggle between Delete and Add based on knowledge base
    if (knownExistingIds.has(playlistId)) {
      renderDeleteButton(container, playlistId);
    } else {
      renderAddButton(container, playlistId, link);
    }
  });
}

function renderAlreadyAddedBadge(container) {
  const badge = document.createElement('div');
  badge.className = 'vidopick-element';
  badge.textContent = '✅ Added';
  badge.style.cssText = `
      position: absolute; top: 8px; right: 8px; z-index: 999;
      background-color: #27ae60; color: white; font-size: 12px;
      font-weight: bold; padding: 4px 8px; border-radius: 4px;
      pointer-events: none; opacity: 0.9;
  `;
  container.appendChild(badge);
}

function renderAddButton(container, playlistId, link) {
  const button = document.createElement('button');
  button.className = 'vidopick-element vidopick-add-button';
  button.textContent = '➕ Add';
  button.style.cssText = `
      position: absolute; top: 8px; right: 8px; z-index: 999;
      background-color: #3498db; color: white; border: none;
      border-radius: 4px; padding: 6px 12px; font-size: 14px;
      font-weight: bold; cursor: pointer; transition: background 0.2s;
  `;
  
  button.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      addPlaylistToVidopick(playlistId, button, container, link);
  };
  
  container.appendChild(button);
}

function renderDeleteButton(container, playlistId) {
  const button = document.createElement('button');
  button.className = 'vidopick-element vidopick-delete-button';
  button.textContent = '🗑️ Delete';
  button.style.cssText = `
      position: absolute; top: 8px; right: 8px; z-index: 999;
      background-color: #e74c3c; color: white; border: none;
      border-radius: 4px; padding: 6px 12px; font-size: 14px;
      font-weight: bold; cursor: pointer; transition: background 0.2s;
  `;
  
  button.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (confirm(`Are you sure you want to delete playlist ${playlistId} from Vidopick?`)) {
          deletePlaylistFromVidopick(playlistId, button, container);
      }
  };
  
  container.appendChild(button);
}

function renderStatusBadge(container, text, color) {
  const badge = document.createElement('div');
  badge.className = 'vidopick-element vidopick-status-badge';
  badge.textContent = text;
  badge.style.cssText = `
      position: absolute; top: 8px; right: 8px; z-index: 1000;
      background-color: ${color}; color: white; font-size: 12px;
      font-weight: bold; padding: 6px 12px; border-radius: 4px;
      pointer-events: none; opacity: 1; transition: opacity 0.5s;
  `;
  container.appendChild(badge);
  return badge;
}

async function deletePlaylistFromVidopick(playlistId, button, container) {
  try {
    button.textContent = '⏳';
    button.disabled = true;

    if (!config.extensionApiKey) {
      throw new Error('Extension API key not configured');
    }

    const { projectId } = config.firebaseConfig;
    const url = `https://us-central1-${projectId}.cloudfunctions.net/deletePlaylistFromExtension`;

    const response = await fetch(url, {
      method: 'POST', // Using POST to match your API key verification pattern
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        apiKey: config.extensionApiKey,
        playlistId: playlistId
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || `Server returned ${response.status}`);
    }

    // Update local UI state
    knownExistingIds.delete(playlistId);
    button.remove();
    
    // Show temporary deleted badge
    const deletedBadge = renderStatusBadge(container, '🗑️ Deleted', '#7f8c8d');
    
    // After 2 seconds, remove badge and re-scan to show "Add" button
    setTimeout(() => {
        deletedBadge.remove();
        injectButtons(); 
    }, 2000);

  } catch (error) {
    showErrorModal("Delete Failed", error.message);
    button.textContent = '🗑️ Delete';
    button.disabled = false;
  }
}

// --- MAIN PROCESS (CLEAN & PRODUCTION READY) ---

async function addPlaylistToVidopick(playlistId, button, container, linkElement) {
  try {
    button.textContent = '⏳';
    button.disabled = true;

    // 1. SCOPE: Find the true card wrapper that contains everything (Image + Text + Button)
    const cardWrapper = button.closest('yt-lockup-view-model') || 
                        button.closest('ytd-grid-playlist-renderer') ||
                        button.closest('ytd-compact-playlist-renderer') ||
                        button.closest('ytd-playlist-renderer') ||
                        container;

    // 2. SCRAPE VIDEO COUNT
    let visibleVideoCount = 0;

    // Strategy A: Watch Page Panel (e.g. "1 / 26")
    try {
        const indexMessage = cardWrapper.querySelector('.index-message'); 
        if (indexMessage) {
             const parts = indexMessage.textContent.trim().split('/');
             if (parts.length > 1) {
                 visibleVideoCount = parseInt(parts[parts.length - 1].replace(/,/g, ''), 10);
             }
        }
    } catch (e) {}

    // Strategy B: Browse Page Badge (e.g. "9 videos" on thumbnail)
    if (visibleVideoCount === 0) {
        const badge = cardWrapper.querySelector('.yt-badge-shape__text') || 
                      cardWrapper.querySelector('ytd-thumbnail-overlay-side-panel-renderer');
        
        if (badge) {
            const match = badge.textContent.trim().match(/([\d,]+)/); 
            if (match) {
                visibleVideoCount = parseInt(match[1].replace(/,/g, ''), 10);
            }
        }
    }

    // Strategy C: Nuclear Text Search (Fallback for any "X videos" text)
    if (visibleVideoCount === 0) {
        try {
            const allElements = cardWrapper.getElementsByTagName('*');
            for (let el of allElements) {
                // Skip technical tags and buttons
                if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'BUTTON'].includes(el.tagName)) continue;

                const text = el.textContent ? el.textContent.trim() : "";
                if (!text) continue;

                // Regex: "9 videos" or "1,200 videos"
                const videoMatch = text.match(/^([\d,]+)\s+videos?$/i);
                
                if (videoMatch && el.children.length === 0) {
                    visibleVideoCount = parseInt(videoMatch[1].replace(/,/g, ''), 10);
                    break; 
                }
            }
        } catch (e) {}
    }

    // 3. VALIDATION: Block if we found a valid count < MIN_VIDS_REQUIRED
    if (visibleVideoCount > 0 && visibleVideoCount < MIN_VIDS_REQUIRED) {
         showErrorModal("Too Few Videos", `The label says this playlist only has ${visibleVideoCount} videos. Minimum required is ${MIN_VIDS_REQUIRED}.`);
         resetButton(button);
         return;
    }

    // 4. TITLE & THUMBNAIL
    let title = "Unknown Title";
    const h3WithTitle = cardWrapper.querySelector('h3.yt-lockup-metadata-view-model__heading-reset');
    const headerTitle = cardWrapper.querySelector('#header-description h3 a'); 

    if (h3WithTitle && h3WithTitle.getAttribute('title')) {
        title = h3WithTitle.getAttribute('title');
    } else if (headerTitle) {
        title = headerTitle.textContent.trim();
    } else {
        const videoTitleEl = cardWrapper.querySelector('#video-title');
        if (videoTitleEl) title = videoTitleEl.textContent.trim();
        else if (linkElement && linkElement.getAttribute('aria-label')) title = linkElement.getAttribute('aria-label');
    }
    title = title.replace(/View full playlist/i, "").trim();

    const imgEl = cardWrapper.querySelector('img');
    const thumbnail = imgEl ? imgEl.src : "";

    // 5. FETCH FEED (For AI titles & fallback count)
    const feedData = await fetchPlaylistFeed(playlistId);
    
    // Prefer UI count (accurate), fallback to RSS count (capped at 15)
    const finalVideoCount = visibleVideoCount > 0 ? visibleVideoCount : feedData.totalCount;

    // Final safety check
    if (finalVideoCount < MIN_VIDS_REQUIRED) {
      showErrorModal("Too Few Videos", `This playlist only has ${finalVideoCount} videos. Minimum required is ${MIN_VIDS_REQUIRED}.`);
      resetButton(button);
      return;
    }

    if ((!title || title === "Unknown Title") && feedData.feedTitle) {
        title = feedData.feedTitle;
    }

    const playlist = { 
        playlistId, 
        title, 
        channelTitle: feedData.channelTitle || "YouTube Channel", 
        thumbnail 
    };

    if (feedData.firstVideoId) playlist.thumbnail = `https://img.youtube.com/vi/${feedData.firstVideoId}/mqdefault.jpg`;

    // 6. AI ANALYSIS
    const analysis = await analyzePlaylistWithAI(playlist, feedData.titles);
    if (analysis.error) {
       showErrorModal("AI Error", analysis.error);
       resetButton(button);
       return;
    }
    if (!analysis.isAppropriate) {
       const reason = analysis.reasoning || "Content was flagged as inappropriate.";
       showErrorModal("Playlist Rejected", `<strong>Reason:</strong> ${reason}<br><br><em>(Confidence: ${analysis.confidenceScore}/10)</em>`);
       button.style.backgroundColor = '#e74c3c';
       button.textContent = '❌';
       setTimeout(() => resetButton(button), 3000);
       return;
    }

    // 7. PREPARE & SAVE
    const engagement = calculateEngagementScore(feedData.views);
    const aiScore = analysis.confidenceScore;
    const rankingScore = Math.round((aiScore * 0.4 + 10 * 0.3 + engagement * 0.2 + 0.7) * 10) / 10;
    
    const stableAuthorUrl = feedData.channelId 
        ? `https://www.youtube.com/channel/${feedData.channelId}`
        : `https://www.youtube.com/results?search_query=${encodeURIComponent(feedData.channelTitle)}`;

    const playlistData = {
      id: playlistId,
      title: playlist.title,
      thumbnail: playlist.thumbnail,
      author: feedData.channelTitle,
      authorUrl: stableAuthorUrl,
      ageMin: analysis.ageMin,
      ageMax: analysis.ageMax,
      tags: analysis.tags,
      category: analysis.category,
      categories: Array.isArray(analysis.categories) ? analysis.categories : [analysis.categories || analysis.category || 'Entertainment'],
      languages: Array.isArray(analysis.languages) ? analysis.languages : [analysis.languages || analysis.language || 'English'],
      description: analysis.briefDescription,
      sourceUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
      // videos: finalVideoCount, // Count can change any time. No need to save.
      ranking: { score: rankingScore, boost: 0, factors: { aiScore, channelAuthority: 10, engagement, freshness: 7 }},
      channelSubscribers: 0,
      channelVerified: false,
      isApproved: analysis.confidenceScore >= 8,
      isAppropriate: analysis.isAppropriate,
      reviewedBy: config.editorName,
      reviewedAt: new Date(),
      scannedAt: new Date(),
      updatedAt: new Date(),
      scannedBy: 'chrome-extension',
      importCount: 0,
      likes: 0,
    };

    await savePlaylistToFirestore(playlistData);

    knownExistingIds.add(playlistId);
    button.remove();

    // Show temporary success badge
    const successBadge = renderStatusBadge(cardWrapper, '✅ Added', '#27ae60');
    
    // After 2 seconds, remove badge and show the Delete button
    setTimeout(() => {
        successBadge.remove();
        renderDeleteButton(cardWrapper, playlistId);
    }, 2000);

  } catch (error) {
    showErrorModal("Save Failed", error.message);
    resetButton(button);
  }
}

// --- HELPERS ---

function showErrorModal(title, message) {
  const existing = document.getElementById('vidopick-modal');
  if (existing) existing.remove();
  const modalOverlay = document.createElement('div');
  modalOverlay.id = 'vidopick-modal';
  modalOverlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 2147483647; display: flex; align-items: center; justify-content: center; font-family: Roboto, Arial, sans-serif;`;
  const modalBox = document.createElement('div');
  modalBox.style.cssText = `background: white; width: 400px; padding: 24px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); position: relative; animation: fadeIn 0.2s ease-out;`;
  modalBox.innerHTML = `<h2 style="margin: 0 0 16px 0; color: #e74c3c; font-size: 20px; display: flex; align-items: center;"><span style="margin-right: 8px;">⚠️</span> ${title}</h2><div style="font-size: 14px; color: #333; line-height: 1.5; margin-bottom: 24px;">${message}</div><div style="text-align: right;"><button id="vidopick-close-btn" style="background: #333; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px;">Close</button></div>`;
  modalOverlay.appendChild(modalBox);
  document.body.appendChild(modalOverlay);
  document.getElementById('vidopick-close-btn').onclick = () => modalOverlay.remove();
  modalOverlay.onclick = (e) => { if (e.target === modalOverlay) modalOverlay.remove(); };
}

function resetButton(button) {
  button.textContent = '➕ Add';
  button.disabled = false;
  button.style.backgroundColor = '#3498db';
}

async function analyzePlaylistWithAI(playlist, videoTitles) {
  if (!config.openaiApiKey) return { error: "Missing OpenAI API Key" };
  const prompt = `Analyze this YouTube playlist for children.\nPlaylist: ${playlist.title}\nFirst 10 videos: ${videoTitles.slice(0, 10).join(', ')}\nRespond with JSON: {"isAppropriate": true/false, "confidenceScore": 1-10, "ageMin": 0-12, "ageMax": 0-12, "categories": ["Category1"], "tags": ["tag"], "languages": ["English"], "briefDescription": "Desc", "reasoning": "Reason"}\nIMPORTANT for categories: always return an array. Use values from this list when possible: ["Educational","Music","Stories","Animation","Art & Crafts","Dance & Fitness","Health & Wellness","Language","Entertainment"]. Prefer existing categories — only use a new value if genuinely distinct. 1 category is ideal, 2 if truly both apply.\nIMPORTANT for languages: always return an array. Single language: ["English"]. Multiple: ["English", "Spanish"]. Never use "Multiple" — list the actual languages.`;
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.openaiApiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: 'You are a kids content curator. Allow classic cartoon violence (like Tom & Jerry) but block realistic violence, gore, or sexual themes. JSON only.' }, { role: 'user', content: prompt }],
        temperature: 0.4,
        response_format: { type: 'json_object' },
      }),
    });
    const data = await response.json();
    if (data.error) return { error: `OpenAI Error: ${data.error.message}` };
    return JSON.parse(data.choices[0].message.content);
  } catch (error) { return { error: `Network Error: ${error.message}` }; }
}

async function fetchPlaylistFeed(playlistId) {
  try {
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`);
    if (!response.ok) throw new Error('Feed fetch failed');
    const text = await response.text();
    const videoTitles = [];
    const videoViews = [];
    const titleMatches = text.matchAll(/<media:title>(.*?)<\/media:title>/g);
    for (const match of titleMatches) videoTitles.push(decodeHtmlEntities(match[1]));
    const viewMatches = text.matchAll(/<media:statistics views="(\d+)"\/>/g);
    for (const match of viewMatches) videoViews.push(parseInt(match[1], 10));
    const videoIdMatch = text.match(/<yt:videoId>([a-zA-Z0-9_-]{11})<\/yt:videoId>/);
    const channelNameMatch = text.match(/<name>(.*?)<\/name>/);
    const channelIdMatch = text.match(/\/channel\/(UC[\w-]+)/);
    const feedTitleMatch = text.match(/<title>(.*?)<\/title>/);
    return { 
        titles: videoTitles.slice(0, 20), views: videoViews.slice(0, 20), firstVideoId: videoIdMatch ? videoIdMatch[1] : null, totalCount: videoTitles.length,
        channelTitle: channelNameMatch ? decodeHtmlEntities(channelNameMatch[1]) : "YouTube Channel",
        channelId: channelIdMatch ? channelIdMatch[1] : null,
        feedTitle: feedTitleMatch ? decodeHtmlEntities(feedTitleMatch[1]) : null 
    };
  } catch (error) { return { titles: [], views: [], firstVideoId: null, totalCount: 0, channelTitle: "YouTube Channel", channelId: null, feedTitle: null }; }
}

function calculateEngagementScore(videoViews) {
  if (!videoViews || videoViews.length === 0) return 5;
  const avg = videoViews.reduce((a, b) => a + b, 0) / videoViews.length;
  if (avg > 1000000) return 10;
  if (avg > 500000) return 9;
  if (avg > 100000) return 8;
  if (avg > 50000) return 7;
  return 6;
}

async function savePlaylistToFirestore(playlistData) {
  if (!config.extensionApiKey) {
    throw new Error('Extension API key not configured');
  }

  const { firebaseConfig } = config;
  const url = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/savePlaylistFromExtension`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      apiKey: config.extensionApiKey,
      playlistData: playlistData
    }),
  });
  
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    
    if (response.status === 401) {
      throw new Error('Invalid extension API key. Please check your settings.');
    }
    
    throw new Error(`Failed to save: ${errorBody.error || response.statusText} (${response.status})`);
  }
  
  const result = await response.json();
  console.log('Playlist saved successfully:', result);
}

function decodeHtmlEntities(text) {
  const entities = {'&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&#39;':"'", '&apos;':"'"};
  return text.replace(/&(?:amp|lt|gt|quot|#39|apos);/g, m => entities[m] || m);
}