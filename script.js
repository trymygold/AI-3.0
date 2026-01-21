/* script.js - Jewels-Ai Atelier: v7.0 (Final Pallavi Edition) */

/* --- CONFIGURATION --- */
// 🛑 STOP! PASTE YOUR PUBLISHED CSV LINK BELOW.
// It must end with "output=csv". Do NOT use the "edit?usp=sharing" link.
const PRICELIST_SHEET_URL = "PASTE_YOUR_PUBLISHED_CSV_LINK_HERE";

// ⚠️ API KEY (Restrict in Google Cloud Console)
const API_KEY = "AIzaSyAXG3iG2oQjUA_BpnO8dK8y-MHJ7HLrhyE"; 

const DRIVE_FOLDERS = {
  earrings: "1eftKhpOHbCj8hzO11-KioFv03g0Yn61n",
  chains: "1G136WEiA9QBSLtRk0LW1fRb3HDZb4VBD",
  rings: "1iB1qgTE-Yl7w-CVsegecniD_DzklQk90",
  bangles: "1d2b7I8XlhIEb8S_eXnRFBEaNYSwngnba"
};

/* --- ASSETS & STATE --- */
const JEWELRY_ASSETS = {}; 
const CATALOG_PROMISES = {}; 
const IMAGE_CACHE = {}; 
let PRICE_DATABASE = {}; // Stores Excel Data
let dailyItem = null; 

const watermarkImg = new Image(); watermarkImg.src = 'logo_watermark.png'; 

/* DOM Elements */
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');
const loadingStatus = document.getElementById('loading-status');
const flashOverlay = document.getElementById('flash-overlay'); 
const voiceBtn = document.getElementById('voice-btn'); 

/* App State */
let earringImg = null, necklaceImg = null, ringImg = null, bangleImg = null;
let currentType = ''; 
let isProcessingHand = false, isProcessingFace = false;
let lastGestureTime = 0;
const GESTURE_COOLDOWN = 800; 
let previousHandX = null;     

/* Tracking Variables */
let currentAssetName = "Select a Design"; 
let currentAssetIndex = 0; 

/* Physics State */
let physics = { earringAngle: 0, earringVelocity: 0, swayOffset: 0, lastHeadX: 0 };
let currentCameraMode = 'user'; 

/* Voice & AI State */
let recognition = null;
let voiceEnabled = true;
let isRecognizing = false;
let autoTryRunning = false;
let autoSnapshots = [];
let autoTryIndex = 0;
let autoTryTimeout = null;
let currentPreviewData = { url: null, name: 'Jewels-Ai_look.png' }; 
const SMOOTH_FACTOR = 0.8; 
let handSmoother = { active: false, ring: { x: 0, y: 0, angle: 0, size: 0 }, bangle: { x: 0, y: 0, angle: 0, size: 0 } };

/* --- 1. GOOGLE SHEET DATABASE LOADER (SMART MATCHING) --- */
async function loadPriceDatabase() {
    try {
        console.log("Attempting to load Price Sheet from:", PRICELIST_SHEET_URL);
        
        if (PRICELIST_SHEET_URL.includes("PASTE_YOUR")) {
            throw new Error("You forgot to paste the CSV link in script.js line 4!");
        }

        const response = await fetch(PRICELIST_SHEET_URL);
        if (!response.ok) throw new Error("Sheet not published or URL wrong (Status: " + response.status + ")");
        
        const text = await response.text();
        const rows = text.split('\n').slice(1); // Skip Header Row
        
        rows.forEach(row => {
            // Split by comma but ignore commas inside quotes
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            if(cols.length >= 2) {
                // Your Sheet Columns: A=Filename, B=Price, C=Weight, D=Style, E=Company
                let rawName = cols[0].replace(/"/g, '').trim(); 
                
                // Store cleaned data
                PRICE_DATABASE[rawName] = {
                    price: cols[1]?.replace(/"/g, '').trim() || "Unknown",
                    weight: cols[2]?.replace(/"/g, '').trim() || "N/A",
                    style: cols[3]?.replace(/"/g, '').trim() || "Standard",
                    company: cols[4]?.replace(/"/g, '').trim() || "Jewels-AI"
                };
            }
        });
        console.log(`Database Loaded: ${Object.keys(PRICE_DATABASE).length} items found.`);
    } catch (e) {
        console.error("CRITICAL ERROR:", e);
        loadingStatus.innerHTML = `<span style="color:red; font-size:14px;">Error: ${e.message}<br>Check Console.</span>`;
    }
}

/* --- 2. AI CONCIERGE "PALLAVI" --- */
const concierge = {
    synth: window.speechSynthesis, voice: null, active: true, hasStarted: false,
    
    responses: {
        greet: ["Namaste! I am Sai Pallavi. Ready to find your perfect look?", "Hello! I am Pallavi. Let's explore some beautiful designs today."],
        praise: ["That looks stunning on you!", "A truly elegant choice.", "Excellent selection. This is a best-seller."],
        crossSell: ["That necklace is beautiful. Would you like to see matching earrings?", "Since you like this chain, shall we try some earrings?"],
        price: ["This is a premium piece.", "A wonderful choice for your budget."] 
    },
    
    init: function() {
        if (speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = this.setVoice;
        this.setVoice();
        setTimeout(() => {
            const bubble = document.getElementById('ai-bubble');
            if(bubble) { bubble.innerText = "Tap me to wake Pallavi"; bubble.classList.add('bubble-visible'); }
        }, 1000);
    },

    setVoice: function() {
        const voices = window.speechSynthesis.getVoices();
        // 1. Google US (Clean) 2. Indian English (Context)
        concierge.voice = voices.find(v => v.name.includes("Google US English")) || 
                          voices.find(v => v.lang === "en-IN") || voices[0];
    },

    speak: function(text) {
        if (!this.active || !this.synth) return;
        const bubble = document.getElementById('ai-bubble');
        const avatar = document.getElementById('ai-avatar');
        if(bubble) { bubble.innerText = text; bubble.classList.add('bubble-visible'); }
        if(avatar) avatar.classList.add('talking');

        if (this.hasStarted) {
            this.synth.cancel();
            const utter = new SpeechSynthesisUtterance(text);
            utter.voice = this.voice; utter.rate = 1.0; utter.pitch = 1.1;
            utter.onend = () => {
                if(bubble) setTimeout(() => bubble.classList.remove('bubble-visible'), 3000);
                if(avatar) avatar.classList.remove('talking');
            };
            this.synth.speak(utter);
        } else {
            setTimeout(() => { if(avatar) avatar.classList.remove('talking'); if(bubble) bubble.classList.remove('bubble-visible'); }, 3000);
        }
    },

    speakRandom: function(category) {
        const options = this.responses[category];
        if (options) this.speak(options[Math.floor(Math.random() * options.length)]);
    },

    toggle: function() {
        if (!this.hasStarted) { this.hasStarted = true; this.speakRandom('greet'); return; }
        this.active = !this.active;
        if(this.active) this.speak("I am listening.");
        else { this.synth.cancel(); document.getElementById('ai-bubble').innerText = "Muted"; }
    }
};

window.toggleConciergeMute = () => concierge.toggle();

/* --- HELPER FUNCTIONS --- */
function lerp(start, end, amt) { return (1 - amt) * start + amt * end; }

function getActiveProductMeta() {
    if (!JEWELRY_ASSETS[currentType]) return null;
    return JEWELRY_ASSETS[currentType][currentAssetIndex].meta;
}

/* --- 3. BACKGROUND FETCHING (UPDATED FOR SHEET MATCHING) --- */
function initBackgroundFetch() {
    Object.keys(DRIVE_FOLDERS).forEach(key => { fetchCategoryData(key); });
}

function fetchCategoryData(category) {
    if (CATALOG_PROMISES[category]) return CATALOG_PROMISES[category];

    const fetchPromise = new Promise(async (resolve, reject) => {
        try {
            const folderId = DRIVE_FOLDERS[category];
            const query = `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`;
            const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&pageSize=1000&fields=files(id,name,thumbnailLink)&key=${API_KEY}`;
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.error) throw new Error(data.error.message);

            JEWELRY_ASSETS[category] = data.files.map(file => {
                const baseLink = file.thumbnailLink;
                let thumbSrc = baseLink ? baseLink.replace(/=s\d+$/, "=s400") : `https://drive.google.com/thumbnail?id=${file.id}`;
                let fullSrc = baseLink ? baseLink.replace(/=s\d+$/, "=s3000") : `https://drive.google.com/uc?export=view&id=${file.id}`;
                
                // --- SMART MATCHING LOGIC ---
                // 1. Try Exact Match
                let meta = PRICE_DATABASE[file.name];
                
                // 2. If not found, try removing extension (e.g. "2334.jpg" -> "2334")
                if (!meta) {
                    const nameNoExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                    meta = PRICE_DATABASE[nameNoExt];
                }

                // 3. Fallback
                if (!meta) {
                    meta = { price: "Unknown", weight: "N/A", style: "Standard", company: "Jewels-AI" };
                }

                return { id: file.id, name: file.name, thumbSrc: thumbSrc, fullSrc: fullSrc, meta: meta };
            });
            
            if (category === 'earrings') setTimeout(checkDailyDrop, 2000);
            resolve(JEWELRY_ASSETS[category]);
        } catch (err) {
            console.error(`Error loading ${category}:`, err);
            resolve([]); 
        }
    });

    CATALOG_PROMISES[category] = fetchPromise;
    return fetchPromise;
}

/* --- 4. DAILY DROP --- */
function checkDailyDrop() {
    const today = new Date().toDateString();
    const lastSeen = localStorage.getItem('jewels_daily_date');

    if (lastSeen !== today && JEWELRY_ASSETS['earrings'] && JEWELRY_ASSETS['earrings'].length > 0) {
        const list = JEWELRY_ASSETS['earrings'];
        const randomIdx = Math.floor(Math.random() * list.length);
        dailyItem = { item: list[randomIdx], index: randomIdx, type: 'earrings' };
        
        document.getElementById('daily-img').src = dailyItem.item.thumbSrc;
        let cleanName = dailyItem.item.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
        document.getElementById('daily-name').innerText = cleanName;
        document.getElementById('daily-drop-modal').style.display = 'flex';
        
        localStorage.setItem('jewels_daily_date', today);
        concierge.speak("I found a special daily drop for you!");
    }
}
function tryDailyItem() {
    document.getElementById('daily-drop-modal').style.display = 'none';
    if (dailyItem) {
        selectJewelryType(dailyItem.type).then(() => {
            applyAssetInstantly(dailyItem.item, dailyItem.index);
            concierge.speak("Excellent choice. This is trending right now.");
        });
    }
}

function loadAsset(src, id) {
    return new Promise((resolve) => {
        if (!src) { resolve(null); return; }
        if (IMAGE_CACHE[id]) { resolve(IMAGE_CACHE[id]); return; }
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => { IMAGE_CACHE[id] = img; resolve(img); };
        img.onerror = () => { resolve(null); };
        img.src = src;
    });
}

function setActiveARImage(img) {
    if (currentType === 'earrings') earringImg = img;
    else if (currentType === 'chains') necklaceImg = img;
    else if (currentType === 'rings') ringImg = img;
    else if (currentType === 'bangles') bangleImg = img;
}

/* --- 5. INITIALIZATION --- */
window.onload = async () => {
    await loadPriceDatabase(); // Load Prices FIRST
    initBackgroundFetch();
    concierge.init(); 
    await startCameraFast('user');
    setTimeout(() => { loadingStatus.style.display = 'none'; }, 2000);
    await selectJewelryType('earrings');
};

/* --- 6. CORE LOGIC --- */
async function selectJewelryType(type) {
  if (currentType === type) return;
  currentType = type;
  if(concierge.hasStarted) concierge.speak(`${type.charAt(0).toUpperCase() + type.slice(1)} mode active.`);
  
  const targetMode = (type === 'rings' || type === 'bangles') ? 'environment' : 'user';
  startCameraFast(targetMode); 

  earringImg = null; necklaceImg = null; ringImg = null; bangleImg = null;
  const container = document.getElementById('jewelry-options'); 
  container.innerHTML = ''; 
  
  let assets = JEWELRY_ASSETS[type];
  if (!assets) assets = await fetchCategoryData(type);
  if (!assets || assets.length === 0) return;

  container.style.display = 'flex';
  const fragment = document.createDocumentFragment();
  assets.forEach((asset, i) => {
    const btnImg = new Image(); btnImg.src = asset.thumbSrc; btnImg.crossOrigin = 'anonymous'; btnImg.className = "thumb-btn"; btnImg.loading = "lazy"; 
    btnImg.onclick = () => { applyAssetInstantly(asset, i); };
    fragment.appendChild(btnImg);
  });
  container.appendChild(fragment);
  applyAssetInstantly(assets[0], 0);
}

async function applyAssetInstantly(asset, index) {
    currentAssetIndex = index; currentAssetName = asset.name; highlightButtonByIndex(index);
    const thumbImg = new Image(); thumbImg.src = asset.thumbSrc; thumbImg.crossOrigin = 'anonymous'; setActiveARImage(thumbImg);
    const highResImg = await loadAsset(asset.fullSrc, asset.id);
    if (currentAssetName === asset.name && highResImg) setActiveARImage(highResImg);
}

function highlightButtonByIndex(index) {
    const children = document.getElementById('jewelry-options').children;
    for (let i = 0; i < children.length; i++) {
        if (i === index) { children[i].style.borderColor = "var(--accent)"; children[i].style.transform = "scale(1.05)"; children[i].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }); } 
        else { children[i].style.borderColor = "rgba(255,255,255,0.2)"; children[i].style.transform = "scale(1)"; }
    }
}

function navigateJewelry(dir) {
  if (!currentType || !JEWELRY_ASSETS[currentType]) return;
  const list = JEWELRY_ASSETS[currentType];
  let nextIdx = (currentAssetIndex + dir + list.length) % list.length;
  applyAssetInstantly(list[nextIdx], nextIdx);
}

/* --- 7. CAMERA & AI LOOP --- */
async function startCameraFast(mode = 'user') {
    if (videoElement.srcObject && currentCameraMode === mode && videoElement.readyState >= 2) return;
    currentCameraMode = mode;
    if (videoElement.srcObject) { videoElement.srcObject.getTracks().forEach(track => track.stop()); }
    if (mode === 'environment') { videoElement.classList.add('no-mirror'); } else { videoElement.classList.remove('no-mirror'); }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: mode } });
        videoElement.srcObject = stream;
        videoElement.onloadeddata = () => { videoElement.play(); detectLoop(); if(!recognition) initVoiceControl(); };
    } catch (err) { alert("Camera Error: " + err.message); }
}

async function detectLoop() {
    if (videoElement.readyState >= 2) {
        if (!isProcessingFace) { isProcessingFace = true; await faceMesh.send({image: videoElement}); isProcessingFace = false; }
        if (!isProcessingHand) { isProcessingHand = true; await hands.send({image: videoElement}); isProcessingHand = false; }
    }
    requestAnimationFrame(detectLoop);
}

/* --- 8. MEDIAPIPE FACE --- */
const faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
faceMesh.setOptions({ refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

faceMesh.onResults((results) => {
  if (currentType !== 'earrings' && currentType !== 'chains') return;
  const w = videoElement.videoWidth; const h = videoElement.videoHeight;
  canvasElement.width = w; canvasElement.height = h;
  canvasCtx.save(); canvasCtx.clearRect(0, 0, w, h);
  if (currentCameraMode === 'environment') { canvasCtx.translate(0, 0); canvasCtx.scale(1, 1); } else { canvasCtx.translate(w, 0); canvasCtx.scale(-1, 1); }

  if (results.multiFaceLandmarks && results.multiFaceLandmarks[0]) {
    const lm = results.multiFaceLandmarks[0]; 
    const leftEar = { x: lm[132].x * w, y: lm[132].y * h }; const rightEar = { x: lm[361].x * w, y: lm[361].y * h };
    const neck = { x: lm[152].x * w, y: lm[152].y * h }; const nose = { x: lm[1].x * w, y: lm[1].y * h };
    
    // Physics Logic
    physics.earringVelocity += (-Math.atan2(rightEar.y - leftEar.y, rightEar.x - leftEar.x) - physics.earringAngle) * 0.1; physics.earringVelocity *= 0.92; physics.earringAngle += physics.earringVelocity;
    physics.swayOffset += (lm[1].x*w - physics.lastHeadX) * -1.5; physics.swayOffset *= 0.85; physics.lastHeadX = lm[1].x*w;
    
    const showLeft = (Math.hypot(nose.x-leftEar.x, nose.y-leftEar.y) / Math.hypot(rightEar.x-leftEar.x, rightEar.y-leftEar.y)) > 0.25;
    const showRight = (Math.hypot(nose.x-leftEar.x, nose.y-leftEar.y) / Math.hypot(rightEar.x-leftEar.x, rightEar.y-leftEar.y)) < 0.75;

    if (earringImg && earringImg.complete) {
      let ew = Math.hypot(rightEar.x-leftEar.x, rightEar.y-leftEar.y) * 0.25; let eh = (earringImg.height/earringImg.width) * ew;
      const totalAngle = physics.earringAngle + (physics.swayOffset * 0.5);
      canvasCtx.shadowColor = "rgba(0,0,0,0.5)"; canvasCtx.shadowBlur = 15; canvasCtx.shadowOffsetY = 5;
      if (showLeft) { canvasCtx.save(); canvasCtx.translate(leftEar.x, leftEar.y); canvasCtx.rotate(totalAngle); canvasCtx.drawImage(earringImg, (-ew/2) - (ew*0.05), -eh*0.20, ew, eh); canvasCtx.restore(); }
      if (showRight) { canvasCtx.save(); canvasCtx.translate(rightEar.x, rightEar.y); canvasCtx.rotate(totalAngle); canvasCtx.drawImage(earringImg, (-ew/2) + (ew*0.05), -eh*0.20, ew, eh); canvasCtx.restore(); }
      canvasCtx.shadowColor = "transparent";
    }
    if (necklaceImg && necklaceImg.complete) {
      const nw = Math.hypot(rightEar.x-leftEar.x, rightEar.y-leftEar.y) * 0.85; const nh = (necklaceImg.height/necklaceImg.width) * nw;
      canvasCtx.drawImage(necklaceImg, neck.x - nw/2, neck.y + (nw*0.1), nw, nh);
    }
  }
  canvasCtx.restore();
});

/* --- 9. MEDIAPIPE HANDS --- */
const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
hands.onResults((results) => {
  const w = videoElement.videoWidth; const h = videoElement.videoHeight;
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const lm = results.multiHandLandmarks[0];
      if (!autoTryRunning && (Date.now() - lastGestureTime > GESTURE_COOLDOWN)) {
          if (previousHandX !== null && Math.abs(lm[8].x - previousHandX) > 0.04) { navigateJewelry(lm[8].x - previousHandX < 0 ? 1 : -1); triggerVisualFeedback("Swipe"); lastGestureTime = Date.now(); previousHandX = null; }
          if (Date.now() - lastGestureTime > 100) previousHandX = lm[8].x;
      }
  } else { previousHandX = null; handSmoother.active = false; }

  if (currentType !== 'rings' && currentType !== 'bangles') return;
  canvasElement.width = w; canvasElement.height = h;
  canvasCtx.save(); canvasCtx.clearRect(0, 0, w, h);
  if (currentCameraMode === 'environment') { canvasCtx.translate(0, 0); canvasCtx.scale(1, 1); } else { canvasCtx.translate(w, 0); canvasCtx.scale(-1, 1); }

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const lm = results.multiHandLandmarks[0];
      const mcp = { x: lm[13].x * w, y: lm[13].y * h }; const pip = { x: lm[14].x * w, y: lm[14].y * h };
      const wrist = { x: lm[0].x * w, y: lm[0].y * h }; 
      
      if (!handSmoother.active) {
          handSmoother.ring = { x: mcp.x, y: mcp.y, angle: -Math.PI/2, size: 50 };
          handSmoother.bangle = { x: wrist.x, y: wrist.y, angle: -Math.PI/2, size: 100 };
          handSmoother.active = true;
      } 
      handSmoother.ring.x = lerp(handSmoother.ring.x, mcp.x, SMOOTH_FACTOR);
      handSmoother.ring.y = lerp(handSmoother.ring.y, mcp.y, SMOOTH_FACTOR);
      handSmoother.bangle.x = lerp(handSmoother.bangle.x, wrist.x, SMOOTH_FACTOR);
      handSmoother.bangle.y = lerp(handSmoother.bangle.y, wrist.y, SMOOTH_FACTOR);

      canvasCtx.shadowColor = "rgba(0,0,0,0.4)"; canvasCtx.shadowBlur = 10; canvasCtx.shadowOffsetY = 5;
      if (ringImg && ringImg.complete) {
           const size = Math.hypot(pip.x - mcp.x, pip.y - mcp.y) * 0.6;
           canvasCtx.save(); canvasCtx.translate(handSmoother.ring.x, handSmoother.ring.y); canvasCtx.drawImage(ringImg, -size/2, 0, size, size); canvasCtx.restore();
      }
      canvasCtx.shadowColor = "transparent";
  }
  canvasCtx.restore();
});

/* --- 10. VOICE & UTILS --- */
const VOCAB = {
    next: ['next', 'change', 'another', 'forward', 'skip'],
    back: ['back', 'previous', 'return', 'undo'],
    photo: ['photo', 'capture', 'picture', 'snap', 'shot', 'selfie'],
    price: ['price', 'cost', 'rate', 'how much', 'rupees'],
    praise: ['nice', 'good', 'wow', 'beautiful', 'love', 'like']
};

function initVoiceControl() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { if(voiceBtn) voiceBtn.style.display = 'none'; return; }
    recognition = new SpeechRecognition(); recognition.continuous = true; recognition.interimResults = false; recognition.lang = 'en-US';
    recognition.onstart = () => { isRecognizing = true; if(voiceBtn) { voiceBtn.style.backgroundColor = "rgba(0, 255, 0, 0.2)"; voiceBtn.style.borderColor = "#00ff00"; } };
    recognition.onresult = (event) => { if (event.results[event.results.length - 1].isFinal) processVoiceCommand(event.results[event.results.length - 1][0].transcript.trim().toLowerCase()); };
    recognition.onend = () => { isRecognizing = false; if (voiceEnabled) setTimeout(() => { try { recognition.start(); } catch(e) {} }, 500); else if(voiceBtn) { voiceBtn.style.backgroundColor = "rgba(0,0,0,0.5)"; voiceBtn.style.borderColor = "white"; } };
    try { recognition.start(); } catch(e) {}
}

function toggleVoiceControl() { if (!recognition) { initVoiceControl(); return; } voiceEnabled = !voiceEnabled; if (!voiceEnabled) { recognition.stop(); if(voiceBtn) voiceBtn.classList.add('voice-off'); } else { try { recognition.start(); } catch(e) {} if(voiceBtn) voiceBtn.classList.remove('voice-off'); } }

function processVoiceCommand(cmd) {
    cmd = cmd.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"").toLowerCase(); 
    if (VOCAB.next.some(w => cmd.includes(w))) { navigateJewelry(1); triggerVisualFeedback("Next"); } 
    else if (VOCAB.back.some(w => cmd.includes(w))) { navigateJewelry(-1); triggerVisualFeedback("Back"); } 
    else if (VOCAB.photo.some(w => cmd.includes(w))) { concierge.speakRandom('praise'); setTimeout(takeSnapshot, 1000); } 
    else if (VOCAB.price.some(w => cmd.includes(w))) {
        const meta = getActiveProductMeta();
        if (meta && meta.price !== "Unknown") concierge.speak(`This is a ${meta.style} by ${meta.company}. The price is ${meta.price} rupees.`);
        else concierge.speak("I don't have the details for this piece yet.");
    }
}

/* --- EXPORTS --- */
window.selectJewelryType = selectJewelryType; window.toggleTryAll = toggleTryAll; window.takeSnapshot = takeSnapshot; 
window.downloadAllAsZip = downloadAllAsZip; window.closePreview = closePreview; window.downloadSingleSnapshot = downloadSingleSnapshot; 
window.shareSingleSnapshot = shareSingleSnapshot; window.toggleVoiceControl = toggleVoiceControl;
window.tryDailyItem = () => { document.getElementById('daily-drop-modal').style.display = 'none'; }; window.closeDailyDrop = () => { document.getElementById('daily-drop-modal').style.display = 'none'; };

/* --- HELPERS --- */
function triggerVisualFeedback(text) { const f = document.createElement('div'); f.innerText = text; f.style.cssText = 'position:fixed; top:20%; left:50%; transform:translate(-50%,-50%); background:rgba(0,0,0,0.7); color:#fff; padding:10px 20px; border-radius:20px; z-index:1000;'; document.body.appendChild(f); setTimeout(() => f.remove(), 1000); }
function triggerFlash() { if(flashOverlay) { flashOverlay.classList.remove('flash-active'); void flashOverlay.offsetWidth; flashOverlay.classList.add('flash-active'); } }
function toggleTryAll() { alert("Try All feature active!"); } 
function captureToGallery() {
    const tempCanvas = document.createElement('canvas'); tempCanvas.width = videoElement.videoWidth; tempCanvas.height = videoElement.videoHeight; const tempCtx = tempCanvas.getContext('2d');
    if (currentCameraMode === 'environment') tempCtx.drawImage(videoElement, 0, 0); else { tempCtx.translate(tempCanvas.width, 0); tempCtx.scale(-1, 1); tempCtx.drawImage(videoElement, 0, 0); tempCtx.setTransform(1, 0, 0, 1, 0, 0); }
    try { tempCtx.drawImage(canvasElement, 0, 0); } catch(e) {}
    
    // Draw Text Overlay with Price/Weight
    const meta = getActiveProductMeta() || {};
    const padding = 20; const h = 100;
    tempCtx.fillStyle = "rgba(0,0,0,0.7)"; tempCtx.fillRect(0, tempCanvas.height - h, tempCanvas.width, h);
    tempCtx.fillStyle = "#d4af37"; tempCtx.font = "bold 30px serif"; tempCtx.fillText(currentAssetName, padding, tempCanvas.height - 60);
    tempCtx.fillStyle = "white"; tempCtx.font = "20px sans-serif"; 
    tempCtx.fillText(`Price: ₹${meta.price || 'N/A'} | ${meta.weight || ''}`, padding, tempCanvas.height - 30);
    
    const dataUrl = tempCanvas.toDataURL('image/png'); 
    currentPreviewData = { url: dataUrl, name: `Jewels-AI_${Date.now()}.png` };
    return currentPreviewData;
}
function takeSnapshot() { triggerFlash(); captureToGallery(); document.getElementById('preview-image').src = currentPreviewData.url; document.getElementById('preview-modal').style.display = 'flex'; }
function downloadSingleSnapshot() { saveAs(currentPreviewData.url, currentPreviewData.name); }
function shareSingleSnapshot() { /* Share logic here */ }
function downloadAllAsZip() { /* Zip logic here */ }
function closePreview() { document.getElementById('preview-modal').style.display = 'none'; }