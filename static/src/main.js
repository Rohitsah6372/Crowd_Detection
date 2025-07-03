// All JavaScript code moved from index.html
// ... existing code ...
const FEED_COUNT = 4;
const videoElements = [];
const canvasOverlays = [];
const ctxs = [];
const startButtons = [];
const stopButtons = [];
const resetROIButtons = [];
const webcamIndexes = [];
const peopleCountSpans = [];
const currentDensitySpans = [];
const predictedDensitySpans = [];
const roiCoordsSpans = [];
const alertBoxes = [];

let isDrawing = Array(FEED_COUNT).fill(false);
let startX = Array(FEED_COUNT).fill(0);
let startY = Array(FEED_COUNT).fill(0);
let roiRect = Array(FEED_COUNT).fill().map(() => ({ x: 0, y: 0, width: 0, height: 0 }));
let currentVideoWidth = Array(FEED_COUNT).fill(0);
let currentVideoHeight = Array(FEED_COUNT).fill(0);
let isFeedActive = Array(FEED_COUNT).fill(false); // Track if feed is active

for (let i = 0; i < FEED_COUNT; i++) {
    videoElements[i] = document.getElementById(`videoElement${i}`);
    canvasOverlays[i] = document.getElementById(`canvasOverlay${i}`);
    if (canvasOverlays[i]) {
        ctxs[i] = canvasOverlays[i].getContext('2d');
    } else {
        ctxs[i] = null;
        console.error(`Canvas element canvasOverlay${i} not found!`);
    }
    startButtons[i] = document.getElementById(`startButton${i}`);
    stopButtons[i] = document.getElementById(`stopButton${i}`);
    resetROIButtons[i] = document.getElementById(`resetROIButton${i}`);
    webcamIndexes[i] = document.getElementById(`webcamIndex${i}`);
    peopleCountSpans[i] = document.getElementById(`peopleCount${i}`);
    currentDensitySpans[i] = document.getElementById(`currentDensity${i}`);
    predictedDensitySpans[i] = document.getElementById(`predictedDensity${i}`);
    roiCoordsSpans[i] = document.getElementById(`roiCoords${i}`);
    alertBoxes[i] = document.getElementById(`alertBox${i}`);

    // Canvas resize
    function updateCanvasSize(idx) {
        if (!videoElements[idx] || !canvasOverlays[idx]) return;
        currentVideoWidth[idx] = videoElements[idx].offsetWidth;
        currentVideoHeight[idx] = videoElements[idx].offsetHeight;
        canvasOverlays[idx].width = currentVideoWidth[idx];
        canvasOverlays[idx].height = currentVideoHeight[idx];
    }
    window.addEventListener('load', () => updateCanvasSize(i));
    window.addEventListener('resize', () => updateCanvasSize(i));
    if (videoElements[i]) videoElements[i].onload = () => updateCanvasSize(i);

    // ROI drawing
    if (canvasOverlays[i] && ctxs[i]) {
        canvasOverlays[i].addEventListener('mousedown', (e) => {
            if (!isFeedActive[i]) {
                alert('Please start the camera feed before drawing ROI.');
                return;
            }
            isDrawing[i] = true;
            const rect = canvasOverlays[i].getBoundingClientRect();
            startX[i] = e.clientX - rect.left;
            startY[i] = e.clientY - rect.top;
            ctxs[i].clearRect(0, 0, canvasOverlays[i].width, canvasOverlays[i].height);
        });
        canvasOverlays[i].addEventListener('mousemove', (e) => {
            if (!isDrawing[i]) return;
            const rect = canvasOverlays[i].getBoundingClientRect();
            const currentX = e.clientX - rect.left;
            const currentY = e.clientY - rect.top;
            const width = currentX - startX[i];
            const height = currentY - startY[i];
            ctxs[i].clearRect(0, 0, canvasOverlays[i].width, canvasOverlays[i].height);
            ctxs[i].strokeStyle = 'cyan';
            ctxs[i].lineWidth = 2;
            ctxs[i].strokeRect(startX[i], startY[i], width, height);
        });
        canvasOverlays[i].addEventListener('mouseup', (event) => {
            if (!isDrawing[i]) return;
            isDrawing[i] = false;
            const rect = canvasOverlays[i].getBoundingClientRect();
            const endX = event.clientX - rect.left;
            const endY = event.clientY - rect.top;
            roiRect[i].x = Math.min(startX[i], endX);
            roiRect[i].y = Math.min(startY[i], endY);
            roiRect[i].width = Math.abs(endX - startX[i]);
            roiRect[i].height = Math.abs(endY - startY[i]);
            // Send ROI to backend
            if (currentVideoWidth[i] > 0 && currentVideoHeight[i] > 0) {
                const roiXPercent = (roiRect[i].x / currentVideoWidth[i]) * 100;
                const roiYPercent = (roiRect[i].y / currentVideoHeight[i]) * 100;
                const roiWPercent = (roiRect[i].width / currentVideoWidth[i]) * 100;
                const roiHPercent = (roiRect[i].height / currentVideoHeight[i]) * 100;
                fetch(`/set_roi?feed=${i}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ x: roiXPercent, y: roiYPercent, w: roiWPercent, h: roiHPercent })
                })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            roiCoordsSpans[i].textContent = `(${roiRect[i].x.toFixed(0)}, ${roiRect[i].y.toFixed(0)}, ${roiRect[i].width.toFixed(0)}, ${roiRect[i].height.toFixed(0)})`;
                        }
                    });
            }
        });
    }
    resetROIButtons[i].addEventListener('click', () => {
        roiRect[i] = { x: 0, y: 0, width: 0, height: 0 };
        ctxs[i].clearRect(0, 0, canvasOverlays[i].width, canvasOverlays[i].height);
        roiCoordsSpans[i].textContent = 'Not set';
        fetch(`/set_roi?feed=${i}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ x: 0, y: 0, w: 0, h: 0 })
        });
    });
    startButtons[i].addEventListener('click', () => {
        const camIndex = webcamIndexes[i].value;
        startButtons[i].disabled = true;
        stopButtons[i].disabled = false;
        fetch('/start_processing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_type: 'webcam', source_path: camIndex, feed: i })
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    videoElements[i].src = `/video_feed/${i}?` + new Date().getTime();
                    isFeedActive[i] = true; // Enable ROI drawing
                } else {
                    alert('Error starting detection: ' + data.message);
                    startButtons[i].disabled = false;
                    stopButtons[i].disabled = true;
                }
            });
    });
    stopButtons[i].addEventListener('click', () => {
        fetch('/stop_processing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feed: i })
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    startButtons[i].disabled = false;
                    stopButtons[i].disabled = true;
                    videoElements[i].src = '';
                    peopleCountSpans[i].textContent = '0';
                    currentDensitySpans[i].textContent = '0.0000';
                    predictedDensitySpans[i].textContent = 'N/A';
                    alertBoxes[i].className = 'alert-message alert-normal';
                    alertBoxes[i].textContent = 'Normal';
                    roiCoordsSpans[i].textContent = 'Not set';
                    isFeedActive[i] = false; // Disable ROI drawing
                }
            });
    });

    // Video upload logic for this camera
    const uploadBtn = document.getElementById(`uploadVideoBtn${i}`);
    const uploadInput = document.getElementById(`videoUploadInput${i}`);
    if (uploadBtn && uploadInput) {
        uploadBtn.addEventListener('click', () => {
            uploadInput.click();
        });
        uploadInput.addEventListener('change', () => {
            const file = uploadInput.files[0];
            if (!file) return;
            const formData = new FormData();
            formData.append('videoFile', file);
            // If webcam is running, stop it first
            if (isFeedActive[i]) {
                fetch('/stop_processing', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ feed: i })
                })
                    .then(() => {
                        isFeedActive[i] = false;
                        startVideoUploadProcessing();
                    });
            } else {
                startVideoUploadProcessing();
            }
            function startVideoUploadProcessing() {
                fetch(`/upload_video?feed=${i}`, {
                    method: 'POST',
                    body: formData
                })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            // Start processing this feed with the uploaded file
                            fetch('/start_processing', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ source_type: 'file', source_path: data.filepath, feed: i })
                            })
                                .then(response => response.json())
                                .then(procData => {
                                    if (procData.success) {
                                        videoElements[i].src = `/video_feed/${i}?` + new Date().getTime();
                                        isFeedActive[i] = true;
                                    } else {
                                        alert('Error starting detection: ' + procData.message);
                                    }
                                });
                        } else {
                            alert('Upload failed: ' + data.message);
                        }
                    })
                    .catch(() => {
                        alert('Error uploading video.');
                    });
            }
        });
    }

    // Add double-click to toggle fullscreen for each camera card
    window.addEventListener('DOMContentLoaded', () => {
        const cameraCards = document.querySelectorAll('.main-content .grid > div');
        if (cameraCards[i]) {
            cameraCards[i].addEventListener('dblclick', function () {
                if (document.fullscreenElement === cameraCards[i] || document.webkitFullscreenElement === cameraCards[i] || document.msFullscreenElement === cameraCards[i]) {
                    // Exit fullscreen
                    if (document.exitFullscreen) {
                        document.exitFullscreen();
                    } else if (document.webkitExitFullscreen) {
                        document.webkitExitFullscreen();
                    } else if (document.msExitFullscreen) {
                        document.msExitFullscreen();
                    }
                } else {
                    // Enter fullscreen
                    if (cameraCards[i].requestFullscreen) {
                        cameraCards[i].requestFullscreen();
                    } else if (cameraCards[i].webkitRequestFullscreen) { // Safari
                        cameraCards[i].webkitRequestFullscreen();
                    } else if (cameraCards[i].msRequestFullscreen) { // IE11
                        cameraCards[i].msRequestFullscreen();
                    }
                }
            });
        }
    });
}

function getAlertClass(message) {
    if (typeof message === 'string') {
        if (message.includes('CRITICAL')) return 'alert-critical';
        if (message.includes('WARNING')) return 'alert-warning';
    }
    return 'alert-normal';
}

// Periodically update stats for each feed and show overall density and predicted density
function updateCameraAndOverallStats() {
    let totalDensity = 0;
    let totalPredDensity = 0;
    let activeCameras = 0;
    for (let i = 0; i < FEED_COUNT; i++) {
        fetch(`/get_current_stats?feed=${i}`)
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    peopleCountSpans[i].textContent = data.people_count;
                    currentDensitySpans[i].textContent =
                        (typeof data.density === 'number' && !isNaN(data.density))
                            ? data.density.toFixed(4)
                            : 'N/A';
                    predictedDensitySpans[i].textContent =
                        (typeof data.pred_density === 'number' && !isNaN(data.pred_density))
                            ? data.pred_density.toFixed(4)
                            : 'N/A';
                    alertBoxes[i].textContent = data.alert_message;
                    alertBoxes[i].className = 'alert-message ' + getAlertClass(data.alert_message);
                    // For overall
                    if (typeof data.density === 'number' && !isNaN(data.density)) {
                        totalDensity += data.density;
                        activeCameras++;
                    }
                    if (typeof data.pred_density === 'number' && !isNaN(data.pred_density)) {
                        totalPredDensity += data.pred_density;
                    }
                }
                // After last camera, update overall
                if (i === FEED_COUNT - 1) {
                    let overallDensity = activeCameras > 0 ? (totalDensity / activeCameras).toFixed(4) : 'N/A';
                    let overallPredDensity = activeCameras > 0 ? (totalPredDensity / activeCameras).toFixed(4) : 'N/A';
                    let overallDiv = document.getElementById('overallDensitySummary');
                    if (!overallDiv) {
                        overallDiv = document.createElement('div');
                        overallDiv.id = 'overallDensitySummary';
                        overallDiv.className = 'w-full text-center mt-4 p-3 bg-indigo-50 rounded-lg font-semibold text-indigo-800';
                        const mainContent = document.querySelector('.main-content');
                        if (mainContent) mainContent.appendChild(overallDiv);
                    }
                    overallDiv.innerHTML = `<span>Overall Density: <span class='font-bold'>${overallDensity}</span></span> &nbsp; | &nbsp; <span>Overall Predicted Density: <span class='font-bold'>${overallPredDensity}</span></span>`;
                }
            });
    }
}
setInterval(updateCameraAndOverallStats, 500);
// Initial call
updateCameraAndOverallStats();

// Add after the for loop
const useMyWebcamBtn = document.getElementById('useMyWebcamBtn');
if (useMyWebcamBtn) {
    useMyWebcamBtn.addEventListener('click', () => {
        const webcamInput = document.getElementById('webcamIndex0');
        if (webcamInput) {
            webcamInput.value = 0;
            document.getElementById('startButton0').click();
        } else {
            alert('Webcam input not found!');
        }
    });
}

// Add a dropdown for selecting the camera feed for history
window.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.querySelector('.sidebar .info-panel.mt-6');
    if (sidebar) {
        const selectDiv = document.createElement('div');
        selectDiv.className = 'mb-3 flex justify-center';
        selectDiv.innerHTML = `
            <label for="historyFeedSelect" class="mr-2 font-semibold text-sm">Select Camera:</label>
            <select id="historyFeedSelect" class="border rounded px-2 py-1 text-sm">
                <option value="0">Camera 1</option>
                <option value="1">Camera 2</option>
                <option value="2">Camera 3</option>
                <option value="3">Camera 4</option>
            </select>
        `;
        sidebar.insertBefore(selectDiv, sidebar.children[1]);
    }
});

// Function to fetch and update head count history for selected feed (dropdown)
function updateSelectedHeadCountHistory() {
    const feedSelect = document.getElementById('historyFeedSelect');
    const feed = feedSelect ? parseInt(feedSelect.value) : 0;
    const container = document.getElementById('multiHistoryContainer');
    if (!container) return;
    container.innerHTML = '';
    fetch(`/get_head_count_history?feed=${feed}`)
        .then(response => response.json())
        .then(data => {
            const table = document.createElement('table');
            table.className = 'alert-history-table';
            const thead = document.createElement('thead');
            thead.innerHTML = `<tr><th>Camera</th><th>Time</th><th>People Count</th></tr>`;
            table.appendChild(thead);
            const tbody = document.createElement('tbody');
            if (data.success && data.history && data.history.length > 0) {
                // Sort by time descending (latest first)
                const sorted = data.history.slice().sort((a, b) => new Date(b.time) - new Date(a.time));
                sorted.forEach(entry => {
                    const tr = document.createElement('tr');
                    const tdCam = document.createElement('td');
                    tdCam.textContent = `Camera ${feed + 1}`;
                    const tdTime = document.createElement('td');
                    tdTime.textContent = entry.time;
                    const tdCount = document.createElement('td');
                    tdCount.textContent = entry.people_count;
                    tr.appendChild(tdCam);
                    tr.appendChild(tdTime);
                    tr.appendChild(tdCount);
                    tbody.appendChild(tr);
                });
            } else {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 3;
                td.className = 'text-center text-gray-500';
                td.textContent = 'No history yet.';
                tr.appendChild(td);
                tbody.appendChild(tr);
            }
            table.appendChild(tbody);
            container.appendChild(table);
        });
}

// Update selected head count history every 30 seconds
setInterval(updateSelectedHeadCountHistory, 30000);
// Initial call
updateSelectedHeadCountHistory();
// Update table when camera selection changes
window.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'historyFeedSelect') {
        updateSelectedHeadCountHistory();
    }
});

// Function to check if a camera has an active ROI (not 'Not set' and not zero size)
function hasActiveROI(idx) {
    const roiSpan = roiCoordsSpans[idx];
    if (!roiSpan) return false;
    const val = roiSpan.textContent || '';
    if (val === 'Not set') return false;
    // Check for zero size ROI
    const match = val.match(/\((\d+), (\d+), (\d+), (\d+)\)/);
    if (match) {
        const w = parseInt(match[3], 10);
        const h = parseInt(match[4], 10);
        return w > 0 && h > 0;
    }
    return false;
}

// Function to render all active camera histories
function updateAllHeadCountHistories() {
    const container = document.getElementById('multiHistoryContainer');
    if (!container) return;
    container.innerHTML = '';
    for (let feed = 0; feed < FEED_COUNT; feed++) {
        if (hasActiveROI(feed)) {
            // Fetch and render table for this feed
            fetch(`/get_head_count_history?feed=${feed}`)
                .then(response => response.json())
                .then(data => {
                    const table = document.createElement('table');
                    table.className = 'alert-history-table';
                    const thead = document.createElement('thead');
                    thead.innerHTML = `<tr><th>Camera</th><th>Time</th><th>People Count</th></tr>`;
                    table.appendChild(thead);
                    const tbody = document.createElement('tbody');
                    if (data.success && data.history && data.history.length > 0) {
                        data.history.forEach(entry => {
                            const tr = document.createElement('tr');
                            const tdCam = document.createElement('td');
                            tdCam.textContent = `Camera ${feed + 1}`;
                            const tdTime = document.createElement('td');
                            tdTime.textContent = entry.time;
                            const tdCount = document.createElement('td');
                            tdCount.textContent = entry.people_count;
                            tr.appendChild(tdCam);
                            tr.appendChild(tdTime);
                            tr.appendChild(tdCount);
                            tbody.appendChild(tr);
                        });
                    } else {
                        const tr = document.createElement('tr');
                        const td = document.createElement('td');
                        td.colSpan = 3;
                        td.className = 'text-center text-gray-500';
                        td.textContent = 'No history yet.';
                        tr.appendChild(td);
                        tbody.appendChild(tr);
                    }
                    table.appendChild(tbody);
                    container.appendChild(table);
                });
        }
    }
}

// Update all head count histories every 5 seconds
setInterval(updateAllHeadCountHistories, 5000);
// Initial call
updateAllHeadCountHistories();

// Add SheetJS CDN for Excel export
if (!window.XLSX) {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    document.head.appendChild(script);
}

// Download Excel for selected camera only
window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('downloadExcelBtn');
    if (btn) {
        btn.addEventListener('click', () => {
            const feedSelect = document.getElementById('historyFeedSelect');
            const feed = feedSelect ? parseInt(feedSelect.value) : 0;
            fetch(`/get_head_count_history?feed=${feed}`)
                .then(response => response.json())
                .then(data => {
                    if (!data.success || !data.history) {
                        alert('No data to export.');
                        return;
                    }
                    let rows = [];
                    data.history.forEach(entry => {
                        rows.push({
                            'Camera': `Camera ${feed + 1}`,
                            'Time': entry.time,
                            'People Count': entry.people_count
                        });
                    });
                    if (rows.length === 0) {
                        alert('No data to export.');
                        return;
                    }
                    // Sort by time (latest first)
                    rows.sort((a, b) => new Date(b.Time) - new Date(a.Time));
                    // Generate worksheet and workbook
                    const ws = XLSX.utils.json_to_sheet(rows);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, `Camera${feed + 1}_History`);
                    XLSX.writeFile(wb, `head_count_history_camera_${feed + 1}.xlsx`);
                });
        });
    }
});

// ... existing code ... 