/* script.js - Jewels-Ai Atelier: v13.0 (Tamil/English Polyglot Edition) */

/* --- CONFIGURATION --- */
const PRICELIST_SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ0GUVaTp6RLxbZIK6vVPsPoknhD8z7RJpsP450vHS2-9FshHs35_KbM2bSQZhoGp3Agww6DId480mo/pub?output=csv";
const API_KEY = "AIzaSyB40AXOyJA6ooHBrh3aO0ajTFSf50rmzMQ"; 

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
let PRICE_DATABASE = {}; 

/* DOM Elements */
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');
const loadingStatus = document.getElementById('loading-status');
const flashOverlay = document.getElementById('flash-overlay'); 
const voiceBtn = document.getElementById('voice-btn'); 
const langBtn = document.getElementById('lang-btn');

/* App State */
let earringImg = null, necklaceImg = null, ringImg = null, bangleImg = null;
let currentType = ''; 
let currentLanguage = 'en-US'; // Default English

/* Tracking Variables */
let currentAssetName = "Select a Design"; 
let currentAssetIndex = 0; 
let physics = { earringAngle: 0, earringVelocity: 0, lastHeadX: 0 };
let currentCameraMode = 'user'; 

/* Virtual Photoshoot State */
let autoTryRunning = false;
let autoSnapshots = [];
let autoTryIndex = 0;
let autoTryTimeout = null;
let currentPreviewData = { url: null, name: 'Jewels-Ai_look.png' }; 
let handSmoother = { active: false, ring: { x: 0, y: 0, angle: 0, size: 0 }, bangle: { x: 0, y: 0, angle: 0, size: 0 } };

/* ---- 1. GOOGLE SHEET DATABASE LOADER ---- */
async function loadPriceDatabase() {
    try {
        const response = await fetch(PRICELIST_SHEET_URL);
        const text = await response.text();
        const rows = text.split('\n').slice(1); 
        rows.forEach(row => {
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            if(cols.length >= 2) {
                let rawName = cols[0].replace(/"/g, '').trim(); 
                PRICE_DATABASE[rawName] = {
                    price: cols[1]?.replace(/"/g, '').trim() || "Unknown",
                    weight: cols[2]?.replace(/"/g, '').trim() || "N/A",
                    style: cols[3]?.replace(/"/g, '').trim() || "Standard",
                    company: cols[4]?.replace(/"/g, '').trim() || "Jewels-AI"
                };
            }
        });
    } catch (e) { console.error("Sheet Error:", e); }
}

/* --- 2. MULTI-LANGUAGE LOGIC --- */
function toggleLanguage() {
    if (currentLanguage === 'en-US') {
        currentLanguage = 'ta-IN'; // Switch to Tamil
        langBtn.innerText = "🇮🇳";
        concierge.speak("Vanakkam. Naan Nila."); // Speak in Tamil
    } else {
        currentLanguage = 'en-US'; // Switch to English
        langBtn.innerText = "🇺🇸";
        concierge.speak("English mode active.");
    }
    // Restart voice recognition with new language
    if (voiceEnabled) {
        if (recognition) recognition.stop();
        setTimeout(initVoiceControl, 500);
    }
}

/* --- 3. AI CONCIERGE "NILA" --- */
const concierge = {
    synth: window.speechSynthesis, voice: null, active: true, hasStarted: false,
    
    init: function() {
        if (speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = this.setVoice;
        this.setVoice();
        setTimeout(() => {
            const bubble = document.getElementById('ai-bubble');
            if(bubble) { bubble.innerText = "Tap me to wake Nila"; bubble.classList.add('bubble-visible'); }
        }, 1000);
    },

    setVoice: function() {
        const voices = window.speechSynthesis.getVoices();
        if (currentLanguage === 'ta-IN') {
            // Try to find a Tamil or Indian voice
            concierge.voice = voices.find(v => v.lang === 'ta-IN') || 
                              voices.find(v => v.lang === 'hi-IN') || 
                              voices.find(v => v.name.includes("India")) || voices[0];
        } else {
            concierge.voice = voices.find(v => v.name.includes("Google US English")) || voices[0];
        }
    },

    speak: function(text) {
        if (!this.active || !this.synth) return;
        this.setVoice(); // Ensure correct voice is loaded

        const bubble = document.getElementById('ai-bubble');
        const avatar = document.getElementById('ai-avatar');
        if(bubble) { bubble.innerText = text; bubble.classList.add('bubble-visible'); }
        if(avatar) avatar.classList.add('talking');

        if (this.hasStarted) {
            this.synth.cancel();
            const utter = new SpeechSynthesisUtterance(text);
            utter.voice = this.voice; utter.rate = 0.9; utter.pitch = 1.0;
            utter.onend = () => {
                if(bubble) setTimeout(() => bubble.classList.remove('bubble-visible'), 4000);
                if(avatar) avatar.classList.remove('talking');
            };
            this.synth.speak(utter);
        }
    },

    toggle: function() {
        if (!this.hasStarted) { this.hasStarted = true; this.speak(currentLanguage === 'ta-IN' ? "Vanakkam! En peyar Nila." : "Hello! I am Nila."); return; }
        this.active = !this.active;
        if(this.active) this.speak("I am listening.");
        else { this.synth.cancel(); if(document.getElementById('ai-bubble')) document.getElementById('ai-bubble').innerText = "Muted"; }
    }
};

/* --- 4. GEMINI AI BRAIN (POLYGLOT) --- */
async function askGemini(userQuestion) {
    if (!API_KEY) return;
    const meta = getActiveProductMeta() || { price: "Unknown", weight: "N/A", style: "Jewelry", company: "Jewels-AI" };
    
    // Dynamic Language Instruction
    const langInstruction = currentLanguage === 'ta-IN' 
        ? "Answer in Tamil language (Tanglish or Tamil Script). Keep it short and poetic." 
        : "Answer in English. Keep it short and elegant.";

    const prompt = `
        You are Nila, a luxury jewelry sales assistant.
        The user is looking at: "${currentAssetName}".
        Details: Price ₹${meta.price}, Weight ${meta.weight}, Style ${meta.style}.
        
        User Question: "${userQuestion}"
        
        ${langInstruction}
    `;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await response.json();
        if (data.candidates && data.candidates[0].content) {
            const reply = data.candidates[0].content.parts[0].text;
            concierge.speak(reply);
        }
    } catch (e) {
        console.error("Gemini Error:", e);
        concierge.speak("Connection error.");
    }
}

/* --- 5. VOICE CONTROL (MULTI-LANG) --- */
let recognition = null; 
let voiceEnabled = true;

function initVoiceControl() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    
    recognition = new SpeechRecognition(); 
    recognition.continuous = false; 
    recognition.interimResults = false; 
    // Dynamically set language
    recognition.lang = currentLanguage; 
    
    recognition.onstart = () => { if(voiceBtn) voiceBtn.style.borderColor = "#00ff00"; };
    recognition.onend = () => { if (voiceEnabled) recognition.start(); else if(voiceBtn) voiceBtn.style.borderColor = "white"; };
    
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.toLowerCase().trim();
        processVoiceCommand(transcript);
    };
    
    try { recognition.start(); } catch(e) {}
}

function processVoiceCommand(cmd) {
    console.log("Heard:", cmd);
    
    // Simple commands (works in English, Gemini handles Tamil commands)
    if (currentLanguage === 'en-US') {
        if (cmd.includes("next") || cmd.includes("change")) { navigateJewelry(1); return; }
        if (cmd.includes("back") || cmd.includes("previous")) { navigateJewelry(-1); return; }
        if (cmd.includes("photo") || cmd.includes("snap")) { takeSnapshot(); return; }
    }
    
    // Send everything else to Gemini (Smart Brain)
    askGemini(cmd);
}

function toggleVoiceControl() {
    voiceEnabled = !voiceEnabled;
    if (voiceEnabled) { initVoiceControl(); concierge.speak("Voice active."); }
    else { if(recognition) recognition.stop(); concierge.speak("Voice off."); }
}

window.toggleConciergeMute = () => concierge.toggle();
window.toggleVoiceControl = toggleVoiceControl;
window.toggleLanguage = toggleLanguage;

/* --- HELPER FUNCTIONS --- */
function lerp(start, end, amt) { return (1 - amt) * start + amt * end; }
function getActiveProductMeta() {
    if (!JEWELRY_ASSETS[currentType]) return null;
    return JEWELRY_ASSETS[currentType][currentAssetIndex].meta;
}

/* --- 6. BACKGROUND FETCHING --- */
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
                
                let meta = PRICE_DATABASE[file.name];
                if (!meta) {
                    const nameNoExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                    meta = PRICE_DATABASE[nameNoExt];
                }
                if (!meta) { meta = { price: "Unknown", weight: "N/A", style: "Standard", company: "Jewels-AI" }; }
                return { id: file.id, name: file.name, thumbSrc: thumbSrc, fullSrc: fullSrc, meta: meta };
            });
            resolve(JEWELRY_ASSETS[category]);
        } catch (err) { resolve([]); }
    });
    CATALOG_PROMISES[category] = fetchPromise;
    return fetchPromise;
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

/* --- 7. INITIALIZATION --- */
window.onload = async () => {
    await loadPriceDatabase(); 
    initBackgroundFetch();
    concierge.init(); 
    initVoiceControl();
    await startCameraFast('user');
    setTimeout(() => { loadingStatus.style.display = 'none'; }, 2000);
    await selectJewelryType('earrings');
};

/* --- 8. CORE LOGIC --- */
async function selectJewelryType(type) {
  if (currentType === type) return;
  currentType = type;
  if(concierge.active) concierge.speak(`${type} mode.`);
  
  const targetMode = (type === 'rings' || type === 'bangles') ? 'environment' : 'user';
  startCameraFast(targetMode); 
  earringImg = null; necklaceImg = null; ringImg = null; bangleImg = null;
  
  const container = document.getElementById('jewelry-options'); container.innerHTML = ''; 
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

/* --- 9. CAMERA LOOP --- */
async function startCameraFast(mode = 'user') {
    if (videoElement.srcObject && currentCameraMode === mode && videoElement.readyState >= 2) return;
    currentCameraMode = mode;
    if (videoElement.srcObject) { videoElement.srcObject.getTracks().forEach(track => track.stop()); }
    if (mode === 'environment') { videoElement.classList.add('no-mirror'); } else { videoElement.classList.remove('no-mirror'); }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: mode } });
        videoElement.srcObject = stream;
        videoElement.onloadeddata = () => { videoElement.play(); detectLoop(); };
    } catch (err) { alert("Camera Error: " + err.message); }
}
async function detectLoop() {
    if (videoElement.readyState >= 2) {
        if (!isProcessingFace) { isProcessingFace = true; await faceMesh.send({image: videoElement}); isProcessingFace = false; }
        if (!isProcessingHand) { isProcessingHand = true; await hands.send({image: videoElement}); isProcessingHand = false; }
    }
    requestAnimationFrame(detectLoop);
}

/* --- 10. MEDIAPIPE FACE (NATURAL PHYSICS + NO SHADOWS) --- */
const faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
faceMesh.setOptions({ refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

faceMesh.onResults((results) => {
  if (currentType !== 'earrings' && currentType !== 'chains') return;
  const w = videoElement.videoWidth; const h = videoElement.videoHeight;
  canvasElement.width = w; canvasElement.height = h;
  canvasCtx.save(); canvasCtx.clearRect(0, 0, w, h);
  
  if (currentCameraMode === 'environment') { canvasCtx.translate(0, 0); canvasCtx.scale(1, 1); } 
  else { canvasCtx.translate(w, 0); canvasCtx.scale(-1, 1); }

  if (results.multiFaceLandmarks && results.multiFaceLandmarks[0]) {
    const lm = results.multiFaceLandmarks[0]; 
    const leftEar = { x: lm[132].x * w, y: lm[132].y * h }; 
    const rightEar = { x: lm[361].x * w, y: lm[361].y * h };
    const neck = { x: lm[152].x * w, y: lm[152].y * h }; 
    const nose = { x: lm[1].x * w, y: lm[1].y * h };

    const headTilt = Math.atan2(rightEar.y - leftEar.y, rightEar.x - leftEar.x);
    
    // Physics Logic
    const restAngle = -headTilt;
    const displacement = restAngle - physics.earringAngle;
    physics.earringVelocity += displacement * 0.12;
    const headX = lm[1].x * w;
    let headVelocity = (headX - physics.lastHeadX);
    if(Math.abs(headVelocity) > 50) headVelocity = 0; 
    physics.lastHeadX = headX;
    physics.earringVelocity -= headVelocity * 0.04; 
    physics.earringVelocity *= 0.92; 
    physics.earringAngle += physics.earringVelocity;
    if (Math.abs(physics.earringAngle - restAngle) > 1.0) { physics.earringVelocity *= 0.8; }
    
    const showLeft = (Math.hypot(nose.x-leftEar.x, nose.y-leftEar.y) / Math.hypot(rightEar.x-leftEar.x, rightEar.y-leftEar.y)) > 0.25;
    const showRight = (Math.hypot(nose.x-leftEar.x, nose.y-leftEar.y) / Math.hypot(rightEar.x-leftEar.x, rightEar.y-leftEar.y)) < 0.75;

    // NO SHADOWS
    canvasCtx.shadowColor = "transparent";

    if (earringImg && earringImg.complete) {
      let ew = Math.hypot(rightEar.x-leftEar.x, rightEar.y-leftEar.y) * 0.25; 
      let eh = (earringImg.height/earringImg.width) * ew;
      
      if (showLeft) { 
          canvasCtx.save(); canvasCtx.translate(leftEar.x, leftEar.y); 
          canvasCtx.rotate(physics.earringAngle); 
          canvasCtx.drawImage(earringImg, (-ew/2), -eh * 0.15, ew, eh); 
          canvasCtx.restore(); 
      }
      if (showRight) { 
          canvasCtx.save(); canvasCtx.translate(rightEar.x, rightEar.y); 
          canvasCtx.rotate(physics.earringAngle); 
          canvasCtx.drawImage(earringImg, (-ew/2), -eh * 0.15, ew, eh); 
          canvasCtx.restore(); 
      }
    }
    if (necklaceImg && necklaceImg.complete) {
      const nw = Math.hypot(rightEar.x-leftEar.x, rightEar.y-leftEar.y) * 0.85; 
      const nh = (necklaceImg.height/necklaceImg.width) * nw;
      canvasCtx.drawImage(necklaceImg, neck.x - nw/2, neck.y + (nw*0.1), nw, nh);
    }
  }
  canvasCtx.restore();
});

/* --- 11. MEDIAPIPE HANDS --- */
const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
function calculateAngle(p1, p2) { return Math.atan2(p2.y - p1.y, p2.x - p1.x); }

hands.onResults((results) => {
  const w = videoElement.videoWidth; const h = videoElement.videoHeight;
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const lm = results.multiHandLandmarks[0];
      if (!autoTryRunning && (Date.now() - lastGestureTime > GESTURE_COOLDOWN)) {
          if (previousHandX !== null && Math.abs(lm[8].x - previousHandX) > 0.04) { navigateJewelry(lm[8].x - previousHandX < 0 ? 1 : -1); lastGestureTime = Date.now(); previousHandX = null; }
          if (Date.now() - lastGestureTime > 100) previousHandX = lm[8].x;
      }
  } else { previousHandX = null; handSmoother.active = false; }

  if (currentType !== 'rings' && currentType !== 'bangles') return;
  canvasElement.width = w; canvasElement.height = h;
  canvasCtx.save(); canvasCtx.clearRect(0, 0, w, h);
  
  let isMirrored = false;
  if (currentCameraMode === 'environment') { canvasCtx.translate(0, 0); canvasCtx.scale(1, 1); } 
  else { canvasCtx.translate(w, 0); canvasCtx.scale(-1, 1); isMirrored = true; }

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const lm = results.multiHandLandmarks[0];
      const mcp = { x: lm[13].x * w, y: lm[13].y * h }; const pip = { x: lm[14].x * w, y: lm[14].y * h };
      const wrist = { x: lm[0].x * w, y: lm[0].y * h }; 
      const indexBase = { x: lm[5].x * w, y: lm[5].y * h };
      
      let ringAngle = calculateAngle(mcp, pip) - (Math.PI / 2);
      let bangleAngle = calculateAngle(wrist, indexBase) - (Math.PI / 2);

      if (isMirrored) {
          ringAngle = -1 * calculateAngle({x: w-mcp.x, y: mcp.y}, {x: w-pip.x, y: pip.y}) - (Math.PI / 2);
          bangleAngle = -1 * calculateAngle({x: w-wrist.x, y: wrist.y}, {x: w-indexBase.x, y: indexBase.y}) - (Math.PI / 2);
      }
      
      const fingerWidth = Math.hypot(pip.x - mcp.x, pip.y - mcp.y) * 1.5; 
      const wristWidth = Math.hypot(indexBase.x - wrist.x, indexBase.y - wrist.y) * 1.6;

      if (!handSmoother.active) {
          handSmoother.ring = { x: mcp.x, y: mcp.y, angle: ringAngle, size: fingerWidth };
          handSmoother.bangle = { x: wrist.x, y: wrist.y, angle: bangleAngle, size: wristWidth };
          handSmoother.active = true;
      } else {
          handSmoother.ring.x = lerp(handSmoother.ring.x, mcp.x, 0.6);
          handSmoother.ring.y = lerp(handSmoother.ring.y, mcp.y, 0.6);
          handSmoother.ring.angle = lerp(handSmoother.ring.angle, ringAngle, 0.6);
          handSmoother.ring.size = lerp(handSmoother.ring.size, fingerWidth, 0.6);
          handSmoother.bangle.x = lerp(handSmoother.bangle.x, wrist.x, 0.6);
          handSmoother.bangle.y = lerp(handSmoother.bangle.y, wrist.y, 0.6);
          handSmoother.bangle.angle = lerp(handSmoother.bangle.angle, bangleAngle, 0.6);
          handSmoother.bangle.size = lerp(handSmoother.bangle.size, wristWidth, 0.6);
      }

      // NO SHADOWS
      canvasCtx.shadowColor = "transparent";

      if (ringImg && ringImg.complete) {
           const rSize = handSmoother.ring.size; const rHeight = (ringImg.height / ringImg.width) * rSize;
           canvasCtx.save(); canvasCtx.translate(handSmoother.ring.x, handSmoother.ring.y); canvasCtx.rotate(handSmoother.ring.angle); 
           canvasCtx.drawImage(ringImg, -rSize/2, -rHeight/2, rSize, rHeight); canvasCtx.restore();
      }
      if (bangleImg && bangleImg.complete) {
           const bSize = handSmoother.bangle.size; const bHeight = (bangleImg.height / bangleImg.width) * bSize;
           canvasCtx.save(); canvasCtx.translate(handSmoother.bangle.x, handSmoother.bangle.y); canvasCtx.rotate(handSmoother.bangle.angle);
           canvasCtx.drawImage(bangleImg, -bSize/2, bHeight * 0.5, bSize, bHeight); canvasCtx.restore();
      }
  }
  canvasCtx.restore();
});

/* --- 12. AUTO-TRY --- */
function toggleTryAll() {
    if (!currentType || !JEWELRY_ASSETS[currentType]) { alert("Please select a category first!"); return; }
    if (autoTryRunning) { stopAutoTry(); } else { startAutoTry(); }
}
function startAutoTry() {
    autoTryRunning = true; autoSnapshots = []; autoTryIndex = 0;
    const btn = document.getElementById('tryall-btn'); if(btn) { btn.innerText = "⏹ Stop"; btn.classList.add("recording-pulse"); }
    runAutoStep();
}
function stopAutoTry() {
    autoTryRunning = false; clearTimeout(autoTryTimeout);
    const btn = document.getElementById('tryall-btn'); if(btn) { btn.innerText = "Try All"; btn.classList.remove("recording-pulse"); }
    if (autoSnapshots.length > 0) showGallery();
}
async function runAutoStep() {
    if (!autoTryRunning) return;
    const assets = JEWELRY_ASSETS[currentType];
    if (!assets || autoTryIndex >= assets.length) { stopAutoTry(); return; }
    const asset = assets[autoTryIndex];
    applyAssetInstantly(asset, autoTryIndex);
    autoTryTimeout = setTimeout(async () => {
        if (!autoTryRunning) return;
        triggerFlash();
        const shot = captureToGallery();
        if(shot) autoSnapshots.push(shot);
        autoTryIndex++;
        runAutoStep(); 
    }, 2000); 
}

/* --- EXPORTS --- */
window.selectJewelryType = selectJewelryType; window.toggleTryAll = toggleTryAll; window.takeSnapshot = takeSnapshot; 
window.downloadAllAsZip = downloadAllAsZip; window.closePreview = closePreview; window.downloadSingleSnapshot = downloadSingleSnapshot; 
window.shareSingleSnapshot = shareSingleSnapshot; 

/* --- HELPERS --- */
function triggerFlash() { if(flashOverlay) { flashOverlay.classList.remove('flash-active'); void flashOverlay.offsetWidth; flashOverlay.classList.add('flash-active'); } }

function captureToGallery() {
    const tempCanvas = document.createElement('canvas'); tempCanvas.width = videoElement.videoWidth; tempCanvas.height = videoElement.videoHeight; const tempCtx = tempCanvas.getContext('2d');
    if (currentCameraMode === 'environment') tempCtx.drawImage(videoElement, 0, 0); else { tempCtx.translate(tempCanvas.width, 0); tempCtx.scale(-1, 1); tempCtx.drawImage(videoElement, 0, 0); tempCtx.setTransform(1, 0, 0, 1, 0, 0); }
    try { tempCtx.drawImage(canvasElement, 0, 0); } catch(e) {}
    
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
function takeSnapshot() { triggerFlash(); captureToGallery(); document.getElementById('preview-image').src = currentPreviewData.url; document.getElementById('preview-modal').style.display = 'flex'; if(concierge.active) concierge.speak(currentLanguage==='ta-IN' ? "Padam eduthachu!" : "Captured!"); }
function downloadSingleSnapshot() { saveAs(currentPreviewData.url, currentPreviewData.name); }
function shareSingleSnapshot() { /* Share logic here */ }
function downloadAllAsZip() { 
    if (autoSnapshots.length === 0) { alert("No photos to download!"); return; }
    const zip = new JSZip(); const folder = zip.folder("Jewels-AI_Collection");
    autoSnapshots.forEach((item) => { const imgData = item.url.replace(/^data:image\/(png|jpg);base64,/, ""); folder.file(item.name, imgData, {base64: true}); });
    zip.generateAsync({type:"blob"}).then(function(content) { saveAs(content, "Jewels-AI_Collection.zip"); });
}
function showGallery() {
    const grid = document.getElementById('gallery-grid'); grid.innerHTML = '';
    if(autoSnapshots.length === 0) return;
    autoSnapshots.forEach((item, index) => {
        const card = document.createElement('div'); card.className = "gallery-card";
        const img = document.createElement('img'); img.src = item.url; img.className = "gallery-img";
        let cleanName = item.name.replace("Jewels-Ai_", "").replace(".png", "").substring(0, 15);
        const overlay = document.createElement('div'); overlay.className = "gallery-overlay"; overlay.innerHTML = `<span class="overlay-text">${cleanName}</span>`;
        card.appendChild(img); card.appendChild(overlay); grid.appendChild(card);
    });
    document.getElementById('gallery-modal').style.display = 'flex';
}
function closePreview() { document.getElementById('preview-modal').style.display = 'none'; }
function closeGallery() { document.getElementById('gallery-modal').style.display = 'none'; }