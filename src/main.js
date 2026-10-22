import MyWorker from './worker.js?worker';

const worker = new MyWorker();

// DOM Elements
const container = document.getElementById('canvas-container');
const canvas = document.getElementById('drawing-canvas');
const ctx = canvas.getContext('2d');

const outputDiv = document.getElementById('output');
const outputLabel = document.getElementById('output-label');
const processBtn = document.getElementById('process-btn');
const clearBtn = document.getElementById('clear-btn');
const penBtn = document.getElementById('pen-btn');
const eraserBtn = document.getElementById('eraser-btn');
const copyBtn = document.getElementById('copy-btn');

const modeTextBtn = document.getElementById('mode-text');
const modeMathBtn = document.getElementById('mode-math');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');

// Application State
let strokes = []; 
let textBlocks = []; 
let pendingBands = null; 

let currentStroke = null;
let currentTool = 'pen';
let currentMode = 'text';
let isDrawing = false;
let latestResult = '';

// Initialize Model
worker.postMessage({ type: 'init', mode: currentMode });

function setMode(newMode) {
  if (currentMode === newMode) return;
  currentMode = newMode;
  
  if (newMode === 'text') {
    modeTextBtn.classList.add('active');
    modeMathBtn.classList.remove('active');
  } else {
    modeMathBtn.classList.add('active');
    modeTextBtn.classList.remove('active');
  }
  
  worker.postMessage({ type: 'init', mode: currentMode });
}

modeTextBtn.addEventListener('click', () => setMode('text'));
modeMathBtn.addEventListener('click', () => setMode('math'));

// Canvas Setup
function resizeCanvas() {
  const rect = container.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  redrawCanvas();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function applyTool() {
  if (currentTool === 'pen') {
    canvas.style.cursor = 'crosshair';
    penBtn.classList.add('active');
    eraserBtn.classList.remove('active');
  } else {
    canvas.style.cursor = 'grab';
    eraserBtn.classList.add('active');
    penBtn.classList.remove('active');
  }
}

penBtn.addEventListener('click', () => { currentTool = 'pen'; applyTool(); });
eraserBtn.addEventListener('click', () => { currentTool = 'eraser'; applyTool(); });

const getPos = (e) => {
  const rect = canvas.getBoundingClientRect();
  const clientX = e.clientX || (e.touches && e.touches[0].clientX);
  const clientY = e.clientY || (e.touches && e.touches[0].clientY);
  return { x: clientX - rect.left, y: clientY - rect.top };
};

// Vector Rendering Engine
function redrawCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#0f172a';

  textBlocks.forEach(block => {
    const blockHeight = block.bounds.maxY - block.bounds.minY;
    const fontSize = Math.max(18, Math.min(36, blockHeight * 0.65));
    ctx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.fillText(block.text, block.x, block.y);
  });

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#000000';

  const drawStroke = (stroke) => {
    if (stroke.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) {
      ctx.lineTo(stroke[i].x, stroke[i].y);
    }
    ctx.stroke();
  };

  strokes.forEach(drawStroke);
  if (currentStroke) drawStroke(currentStroke);
}

// Master Output UI Generator (Line-by-Line with Copy buttons)
function updateOutputBox() {
  outputDiv.innerHTML = '';

  if (textBlocks.length === 0) {
    latestResult = '';
    outputDiv.innerHTML = '<div style="padding: 16px 24px; color: #64748b; font-size: 14px;">Write on the ruled pad above...</div>';
    return;
  }

  const sorted = [...textBlocks].sort((a, b) => {
    if (Math.abs(a.y - b.y) < 18) return a.x - b.x;
    return a.y - b.y;
  });

  const lines = [];
  let currentLine = [];

  sorted.forEach((block, i) => {
    if (i === 0) {
      currentLine.push(block);
      return;
    }

    const prev = sorted[i - 1];
    const isSameLine = Math.abs(block.y - prev.y) < 18;

    if (block.mode === 'math' || prev.mode === 'math') {
      lines.push(currentLine);
      currentLine = [block];
    } else {
      if (isSameLine) {
        currentLine.push(block);
      } else {
        lines.push(currentLine);
        currentLine = [block];
      }
    }
  });
  if (currentLine.length > 0) lines.push(currentLine);

  let fullTextArray = [];

  lines.forEach(lineBlocks => {
    const lineString = lineBlocks.map(b => b.text).join(' ');
    fullTextArray.push(lineString);

    const lineContainer = document.createElement('div');
    lineContainer.className = 'output-line';

    const textSpan = document.createElement('div');
    textSpan.className = 'output-text';
    textSpan.innerText = lineString;

    const btn = document.createElement('button');
    btn.className = 'line-copy-btn';
    btn.innerText = 'Copy';

    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(lineString);
        btn.innerText = 'Copied! ✓';
        setTimeout(() => { btn.innerText = 'Copy'; }, 1500);
      } catch (err) {}
    });

    lineContainer.appendChild(textSpan);
    lineContainer.appendChild(btn);
    outputDiv.appendChild(lineContainer);
  });

  latestResult = fullTextArray.join('\n');
}

function eraseAtPoint(pos) {
  const HIT_RADIUS = 15;
  strokes = strokes.filter(stroke => {
    for (const pt of stroke) {
      if (Math.sqrt((pt.x - pos.x)**2 + (pt.y - pos.y)**2) < HIT_RADIUS) return false;
    }
    return true;
  });
  textBlocks = textBlocks.filter(block => {
    return !(pos.x >= block.bounds.minX - HIT_RADIUS && pos.x <= block.bounds.maxX + HIT_RADIUS &&
             pos.y >= block.bounds.minY - HIT_RADIUS && pos.y <= block.bounds.maxY + HIT_RADIUS);
  });
  redrawCanvas();
  updateOutputBox();
}

// Drawing Event Listeners
const startDrawing = (e) => {
  isDrawing = true;
  const pos = getPos(e);
  if (currentTool === 'eraser') eraseAtPoint(pos);
  else { currentStroke = [pos]; redrawCanvas(); }
};

const draw = (e) => {
  if (!isDrawing) return;
  const pos = getPos(e);
  if (currentTool === 'eraser') eraseAtPoint(pos);
  else if (currentStroke) { currentStroke.push(pos); redrawCanvas(); }
};

const stopDrawing = () => {
  if (!isDrawing) return;
  isDrawing = false;

  if (currentTool === 'pen' && currentStroke) {
    strokes.push(currentStroke);
    currentStroke = null;
    redrawCanvas();
  }
};

canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseleave', stopDrawing);
canvas.addEventListener('touchstart', startDrawing);
canvas.addEventListener('touchmove', (e) => { e.preventDefault(); draw(e); }, { passive: false });
canvas.addEventListener('touchend', stopDrawing);

clearBtn.addEventListener('click', () => {
  strokes = [];
  textBlocks = [];
  redrawCanvas();
  updateOutputBox();
  copyBtn.disabled = true;
  copyBtn.innerText = 'Copy All';
});

copyBtn.addEventListener('click', async () => {
  if (!latestResult) return;
  try {
    await navigator.clipboard.writeText(latestResult);
    copyBtn.innerText = 'Copied! ✓';
    setTimeout(() => { copyBtn.innerText = 'Copy All'; }, 1800);
  } catch (err) {}
});

// Image Export (Invisible Ink Canvas)
function getInkCanvas() {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  const tempCtx = tempCanvas.getContext('2d');

  tempCtx.lineCap = 'round';
  tempCtx.lineJoin = 'round';
  tempCtx.lineWidth = 6;
  tempCtx.strokeStyle = '#000000';

  const drawStroke = (stroke) => {
    if (stroke.length === 0) return;
    tempCtx.beginPath();
    tempCtx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) {
      tempCtx.lineTo(stroke[i].x, stroke[i].y);
    }
    tempCtx.stroke();
  };

  strokes.forEach(drawStroke);
  if (currentStroke) drawStroke(currentStroke);

  return tempCanvas;
}

function exportRegion(sourceCanvas, minX, minY, maxX, maxY) {
  const rawW = maxX - minX;
  const rawH = maxY - minY;
  
  // 1. Add a base padding around the ink
  const basePad = 40;
  const paddedW = rawW + (basePad * 2);
  const paddedH = rawH + (basePad * 2);
  
  // 2. Force a square canvas so TrOCR doesn't distort the aspect ratio
  const size = Math.max(paddedW, paddedH);
  
  // 3. Calculate offsets to perfectly center the handwriting inside the square
  const offsetX = (size - rawW) / 2;
  const offsetY = (size - rawH) / 2;

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = size;
  exportCanvas.height = size;
  const exportCtx = exportCanvas.getContext('2d');

  // Fill with solid white background
  exportCtx.fillStyle = '#ffffff';
  exportCtx.fillRect(0, 0, size, size);
  
  // Draw the un-distorted ink into the exact center of the square
  exportCtx.drawImage(
    sourceCanvas, 
    minX, minY, rawW, rawH, 
    offsetX, offsetY, rawW, rawH
  );

  return exportCanvas.toDataURL('image/png');
}

function getFullCroppedImageWithBounds() {
  const inkCanvas = getInkCanvas();
  const width = inkCanvas.width, height = inkCanvas.height;
  const data = inkCanvas.getContext('2d').getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = 0, maxY = 0, hasInk = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        hasInk = true;
      }
    }
  }
  if (!hasInk) return null;
  return {
    image: exportRegion(inkCanvas, minX, minY, maxX, maxY),
    bounds: { minX, maxX, minY, maxY }
  };
}

function extractTextLinesWithBounds() {
  const inkCanvas = getInkCanvas();
  const width = inkCanvas.width, height = inkCanvas.height;
  const data = inkCanvas.getContext('2d').getImageData(0, 0, width, height).data;
  const rowDensity = new Array(height).fill(0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 20) rowDensity[y]++;
    }
  }

  const lineBands = [];
  let inLine = false, lineStart = 0;

  for (let y = 0; y < height; y++) {
    if (rowDensity[y] > 2) {
      if (!inLine) { inLine = true; lineStart = y; }
    } else {
      if (inLine && y - lineStart >= 12) {
        lineBands.push({ minY: lineStart, maxY: y });
        inLine = false;
      }
    }
  }
  if (inLine && (height - lineStart >= 12)) lineBands.push({ minY: lineStart, maxY: height });
  if (lineBands.length === 0) return null;

  const lines = [];
  for (const band of lineBands) {
    let minX = width, maxX = 0;
    for (let y = band.minY; y <= band.maxY; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 20) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    if (minX <= maxX) {
      lines.push({
        image: exportRegion(inkCanvas, minX, band.minY, maxX, band.maxY),
        bounds: { minX, maxX, minY: band.minY, maxY: band.maxY }
      });
    }
  }
  return lines;
}

function triggerRecognition() {
  const mode = currentMode;
  if (mode === 'text') {
    const linesData = extractTextLinesWithBounds();
    if (!linesData || linesData.length === 0) return;
    
    pendingBands = linesData.map(l => l.bounds);
    worker.postMessage({ type: 'recognize', mode: 'text', image_url: linesData.map(l => l.image) });
  } else {
    const mathData = getFullCroppedImageWithBounds();
    if (!mathData) return;

    pendingBands = [mathData.bounds];
    worker.postMessage({ type: 'recognize', mode: 'math', image_url: mathData.image });
  }
}

processBtn.addEventListener('click', triggerRecognition);

// Worker Response Handler
worker.addEventListener('message', (event) => {
  const { status, message, result, mode, file, progress } = event.data;

  if (status === 'downloading') {
    progressContainer.classList.remove('hidden');
    progressBar.classList.remove('indeterminate');
    progressBar.style.width = `${progress}%`;
    
    outputDiv.innerHTML = `<div style="padding: 16px 24px;">Downloading AI Model (${file})...<br>${Math.round(progress)}% Complete</div>`;
    processBtn.disabled = true;
    copyBtn.disabled = true;

  } else if (status === 'ready') {
    progressContainer.classList.add('hidden');
    if (textBlocks.length === 0) {
      outputDiv.innerHTML = '<div style="padding: 16px 24px; color: #64748b; font-size: 14px;">Write on the ruled pad above...</div>';
    }

    processBtn.disabled = false;

  } else if (status === 'loading' || status === 'processing') {
    progressContainer.classList.remove('hidden');
    progressBar.classList.add('indeterminate');
    
    outputDiv.innerHTML = `<div style="padding: 16px 24px;">${message}</div>`;
    processBtn.disabled = true;
    copyBtn.disabled = true;

  } else if (status === 'complete') {
    progressContainer.classList.add('hidden');
    progressBar.classList.remove('indeterminate');
    
    processBtn.disabled = false;
    copyBtn.disabled = false;

    if (pendingBands && pendingBands.length > 0) {
      const resultLines = result.split('\n');
      
      resultLines.forEach((lineText, i) => {
        const b = pendingBands[i];
        if (b && lineText.trim()) {
          let targetY = b.minY + (b.maxY - b.minY) / 2;
          
          const existingLine = textBlocks.find(tb => Math.abs(tb.y - targetY) < 20);
          if (existingLine) {
            targetY = existingLine.y;
          }

          textBlocks.push({
            text: lineText.trim(),
            x: b.minX,
            y: targetY,
            bounds: b,
            mode: mode
          });
        }
      });

      strokes = strokes.filter(stroke => {
        for (const pt of stroke) {
          for (const b of pendingBands) {
            if (pt.x >= b.minX - 20 && pt.x <= b.maxX + 20 && pt.y >= b.minY - 20 && pt.y <= b.maxY + 20) {
              return false;
            }
          }
        }
        return true; 
      });

      pendingBands = null;
      redrawCanvas(); 
      updateOutputBox(); 
    } else {
      updateOutputBox(); 
    }
  }
});

 // Handle macOS/WebKit backgrounding and wake-ups (MOVED OUTSIDE)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    resizeCanvas();
    redrawCanvas();
    
    if (worker) {
      worker.postMessage({ type: 'init', mode: currentMode });
    }
  }
});