// Global state
let currentFriend = null;
let currentScreenshot = null;
let friendsData = [];
let screenshotsData = [];

// Utility functions
function showStatus(elementId, message, type = 'loading') {
    const element = document.getElementById(elementId);
    element.className = `status ${type}`;
    element.innerHTML = message;
    element.classList.remove('hidden');
}

function hideStatus(elementId) {
    document.getElementById(elementId).classList.add('hidden');
}

function formatTime(timestamp) {
    if (!timestamp) return 'Never';
    try {
        const date = new Date(timestamp * 1000); // Convert from Unix timestamp
        return date.toLocaleString();
    } catch (e) {
        return 'Invalid time';
    }
}

function timeAgo(timestamp) {
    if (!timestamp) return 'Never';
    try {
        const now = Date.now() / 1000;
        const diff = now - timestamp;
        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
        return `${Math.floor(diff / 86400)} days ago`;
    } catch (e) {
        return 'Unknown';
    }
}

// API functions
async function apiCall(url, options = {}) {
    try {
        const response = await fetch(url, options);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }
        return data;
    } catch (error) {
        console.error('API call failed:', error);
        throw error;
    }
}

async function waitForTask(taskId, maxWaitTime = 30) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitTime * 1000) {
        try {
            const result = await apiCall(`/api/task_wait?task_id=${taskId}`);
            if (result.status === 'completed') {
                return result.result;
            } else if (result.status === 'failed') {
                throw new Error(result.error || 'Task failed');
            }
            // Still in progress, wait a bit
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            throw error;
        }
    }
    throw new Error('Task timed out');
}

// Main functions
async function loadFriends() {
    try {
        const data = await apiCall('/api/friends_list');
        friendsData = data.friends || [];
        
        // Update status info
        let lastSyncText = 'Never';
        if (data.last_sync) {
            try {
                // Handle both ISO format and Unix timestamp
                let syncTime;
                if (typeof data.last_sync === 'string') {
                    syncTime = new Date(data.last_sync).getTime() / 1000;
                } else {
                    syncTime = data.last_sync;
                }
                lastSyncText = timeAgo(syncTime);
            } catch (e) {
                lastSyncText = 'Invalid time';
            }
        }
        document.getElementById('last-sync').textContent = lastSyncText;
        document.getElementById('selected-friend').textContent = data.selected_friend || 'None';
        document.getElementById('friends-count').textContent = friendsData.length;

        // Render friends list
        renderFriendsList();
    } catch (error) {
        document.getElementById('friends-container').innerHTML = 
            `<div class="status error">Error loading friends: ${error.message}</div>`;
    }
}

function renderFriendsList() {
    const container = document.getElementById('friends-container');
    
    if (friendsData.length === 0) {
        container.innerHTML = '<div class="status">No friends found. Try syncing first.</div>';
        return;
    }

    container.innerHTML = friendsData.map(friend => {
        const isSelected = friendsData.find(f => f.name === document.getElementById('selected-friend').textContent);
        const selectedIndicator = (friend.name === document.getElementById('selected-friend').textContent) ? ' ✓ ' : '';
        return `
            <div class="friend-item" onclick="showFriendDetail('${friend.name}')">
                <strong>${selectedIndicator}${friend.name}</strong><br>
                <small>Last screenshot: ${friend.last_screenshot_time ? timeAgo(friend.last_screenshot_time) : 'Never'}</small>
            </div>
        `;
    }).join('');
}

async function syncFriends() {
    const syncBtn = document.getElementById('sync-btn');
    syncBtn.disabled = true;
    syncBtn.textContent = 'Syncing...';
    
    try {
        showStatus('sync-status', 'Starting sync...', 'loading');
        
        const response = await apiCall('/api/sync', { method: 'POST' });
        const taskId = response.task_id;
        
        showStatus('sync-status', 'Syncing friends list... This may take a while.', 'loading');
        
        await waitForTask(taskId, 60); // 60 second timeout for sync
        
        showStatus('sync-status', 'Sync completed! Reloading friends list...', 'success');
        
        // Reload friends list
        await loadFriends();
        
        setTimeout(() => hideStatus('sync-status'), 3000);
        
    } catch (error) {
        showStatus('sync-status', `Sync failed: ${error.message}`, 'error');
    } finally {
        syncBtn.disabled = false;
        syncBtn.textContent = 'Sync Friends List';
    }
}

function showFriendDetail(friendName) {
    currentFriend = friendsData.find(f => f.name === friendName);
    if (!currentFriend) {
        console.error(`Friend '${friendName}' not found in loaded data`);
        showFriendsList();
        return;
    }
    
    // Update URL without page reload
    window.history.pushState({view: 'friend', name: friendName}, '', `/friends/${encodeURIComponent(friendName)}`);
    
    // Switch views
    document.getElementById('friends-view').classList.add('hidden');
    document.getElementById('screenshots-view').classList.add('hidden');
    document.getElementById('screenshot-detail-view').classList.add('hidden');
    document.getElementById('friend-detail-view').classList.remove('hidden');
    
    // Update friend details
    document.getElementById('friend-name').textContent = currentFriend.name;
    document.getElementById('friend-selected').textContent = 'Unknown'; // We'll update this
    document.getElementById('friend-last-screenshot').textContent = 
        currentFriend.last_screenshot_time ? formatTime(currentFriend.last_screenshot_time) : 'Never';
    
    // Load screenshot if available
    loadFriendScreenshot();
    
    // Update selected status
    updateFriendSelectedStatus();
}

function showFriendsList() {
    // Update URL
    window.history.pushState({view: 'friends'}, '', '/');
    window.url.location.pathname = '/';
    
    // Switch views
    document.getElementById('friend-detail-view').classList.add('hidden');
    document.getElementById('screenshots-view').classList.add('hidden');
    document.getElementById('screenshot-detail-view').classList.add('hidden');
    document.getElementById('friends-view').classList.remove('hidden');
    
    currentFriend = null;
    currentScreenshot = null;
}

async function updateFriendSelectedStatus() {
    try {
        const data = await apiCall('/api/friends_list');
        const isSelected = data.selected_friend === currentFriend.name;
        document.getElementById('friend-selected').textContent = isSelected ? 'Yes' : 'No';
        
        const selectBtn = document.getElementById('select-friend-btn');
        const screenshotBtn = document.getElementById('take-screenshot-btn');
        
        selectBtn.textContent = isSelected ? 'Already Selected' : 'Select Friend';
        selectBtn.disabled = isSelected;
        
        // Disable screenshot button if friend is not selected
        screenshotBtn.disabled = !isSelected;
        if (!isSelected) {
            screenshotBtn.textContent = 'Select Friend First';
        } else {
            screenshotBtn.textContent = 'Take Screenshot';
        }
    } catch (error) {
        console.error('Failed to update selected status:', error);
    }
}

async function loadFriendScreenshot() {
    const imgElement = document.getElementById('friend-screenshot');
    const noScreenshotElement = document.getElementById('no-screenshot');
    
    if (currentFriend.last_screenshot) {
        try {
            // Check if screenshot file exists by trying to load it
            imgElement.src = `/api/get_screenshot?filename=${currentFriend.last_screenshot}`;
            imgElement.style.display = 'block';
            noScreenshotElement.style.display = 'none';
        } catch (error) {
            imgElement.style.display = 'none';
            noScreenshotElement.style.display = 'block';
        }
    } else {
        imgElement.style.display = 'none';
        noScreenshotElement.style.display = 'block';
    }
}

async function selectCurrentFriend() {
    if (!currentFriend) return;
    
    const selectBtn = document.getElementById('select-friend-btn');
    selectBtn.disabled = true;
    selectBtn.textContent = 'Selecting...';
    
    try {
        showStatus('friend-task-status', 'Selecting friend...', 'loading');
        
        const response = await apiCall('/api/select_friend', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name: currentFriend.name})
        });
        
        const taskId = response.task_id;
        await waitForTask(taskId, 30);
        
        showStatus('friend-task-status', 'Friend selected successfully!', 'success');
        updateFriendSelectedStatus();
        
        setTimeout(() => hideStatus('friend-task-status'), 3000);
        
    } catch (error) {
        showStatus('friend-task-status', `Selection failed: ${error.message}`, 'error');
        selectBtn.disabled = false;
        selectBtn.textContent = 'Select Friend';
    }
}

async function takeScreenshot() {
    const screenshotBtn = document.getElementById('take-screenshot-btn');
    screenshotBtn.disabled = true;
    screenshotBtn.textContent = 'Taking Screenshot...';
    
    try {
        showStatus('friend-task-status', 'Taking screenshot...', 'loading');
        
        const response = await apiCall('/api/take_screenshot', { method: 'POST' });
        const taskId = response.task_id;
        
        const result = await waitForTask(taskId, 15);
        
        showStatus('friend-task-status', 'Screenshot taken successfully!', 'success');
        
        // Reload friend data and screenshot
        await loadFriends();
        currentFriend = friendsData.find(f => f.name === currentFriend.name);
        loadFriendScreenshot();
        
        // Update the last screenshot time display
        document.getElementById('friend-last-screenshot').textContent = 
            currentFriend.last_screenshot_time ? formatTime(currentFriend.last_screenshot_time) : 'Never';
        
        setTimeout(() => hideStatus('friend-task-status'), 3000);
        
    } catch (error) {
        showStatus('friend-task-status', `Screenshot failed: ${error.message}`, 'error');
    } finally {
        screenshotBtn.disabled = false;
        screenshotBtn.textContent = 'Take Screenshot';
    }
}

// Screenshots functions
async function loadScreenshots() {
    try {
        const data = await apiCall('/api/list_screenshots');
        screenshotsData = data.screenshots || [];
        renderScreenshotsList();
    } catch (error) {
        document.getElementById('screenshots-container').innerHTML = 
            `<div class="status error">Error loading screenshots: ${error.message}</div>`;
    }
}

function renderScreenshotsList() {
    const container = document.getElementById('screenshots-container');
    
    if (screenshotsData.length === 0) {
        container.innerHTML = '<div class="status">No screenshots found.</div>';
        return;
    }

    // Sort by modification time, newest first
    const sortedScreenshots = screenshotsData.sort((a, b) => b[1] - a[1]);

    container.innerHTML = sortedScreenshots.map(([filename, timestamp]) => `
        <div class="friend-item" onclick="showScreenshotDetail('${filename}')">
            <strong>${filename}</strong><br>
            <small>Created: ${formatTime(timestamp)}</small>
        </div>
    `).join('');
}

function showScreenshots() {
    // Update URL
    window.history.pushState({view: 'screenshots'}, '', '/screenshots');
    
    // Switch views
    document.getElementById('friends-view').classList.add('hidden');
    document.getElementById('friend-detail-view').classList.add('hidden');
    document.getElementById('screenshot-detail-view').classList.add('hidden');
    document.getElementById('screenshots-view').classList.remove('hidden');
    
    currentFriend = null;
    currentScreenshot = null;
    
    // Load screenshots
    loadScreenshots();
}

async function showScreenshotDetail(filename) {
    currentScreenshot = filename;
    
    // Load screenshots data if not already loaded
    if (screenshotsData.length === 0) {
        try {
            await loadScreenshots();
        } catch (error) {
            console.error('Failed to load screenshots:', error);
            showScreenshots();
            return;
        }
    }
    
    // Verify the screenshot exists in our data
    const screenshotExists = screenshotsData.some(([name]) => name === filename);
    if (!screenshotExists) {
        console.error(`Screenshot '${filename}' not found`);
        showScreenshots();
        return;
    }
    
    // Update URL
    window.history.pushState({view: 'screenshot', filename: filename}, '', `/screenshots/${encodeURIComponent(filename)}`);
    
    // Switch views
    document.getElementById('screenshots-view').classList.add('hidden');
    document.getElementById('screenshot-detail-view').classList.remove('hidden');
    
    // Update screenshot details
    document.getElementById('screenshot-name').textContent = filename;
    
    // Load the screenshot image
    const imgElement = document.getElementById('current-screenshot');
    const errorElement = document.getElementById('screenshot-error');
    
    imgElement.onload = function() {
        imgElement.style.display = 'block';
        errorElement.classList.add('hidden');
    };
    
    imgElement.onerror = function() {
        imgElement.style.display = 'none';
        errorElement.classList.remove('hidden');
    };
    
    imgElement.src = `/api/get_screenshot?filename=${encodeURIComponent(filename)}`;
}

async function deleteCurrentScreenshot() {
    if (!currentScreenshot) return;
    
    if (!confirm(`Are you sure you want to delete "${currentScreenshot}"?`)) {
        return;
    }
    
    const deleteBtn = document.getElementById('delete-screenshot-btn');
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';
    
    try {
        showStatus('screenshot-task-status', 'Deleting screenshot...', 'loading');
        
        await apiCall('/api/delete_screenshot', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({filename: currentScreenshot})
        });
        
        showStatus('screenshot-task-status', 'Screenshot deleted successfully!', 'success');
        
        // Go back to screenshots list
        setTimeout(() => {
            showScreenshots();
        }, 1000);
        
    } catch (error) {
        showStatus('screenshot-task-status', `Delete failed: ${error.message}`, 'error');
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete Screenshot';
    }
}

async function deleteAllScreenshots() {
    if (!confirm('Are you sure you want to delete ALL screenshots? This cannot be undone!')) {
        return;
    }
    
    const deleteBtn = document.getElementById('delete-all-screenshots-btn');
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting All...';
    
    try {
        showStatus('screenshots-task-status', 'Deleting all screenshots...', 'loading');
        
        const result = await apiCall('/api/delete_all_screenshots', { method: 'POST' });
        
        showStatus('screenshots-task-status', `Deleted ${result.deleted_files.length} screenshots successfully!`, 'success');
        
        // Reload screenshots list
        await loadScreenshots();
        
        setTimeout(() => hideStatus('screenshots-task-status'), 3000);
        
    } catch (error) {
        showStatus('screenshots-task-status', `Delete failed: ${error.message}`, 'error');
    } finally {
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete All Screenshots';
    }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    // Force URL to home immediately
    if (window.location.pathname !== '/') {
        window.history.replaceState({view: 'friends'}, '', '/');
    }
    loadFriends();
});

// Simple home button function
function goHome() {
    window.history.pushState({view: 'friends'}, '', '/');
    showFriendsList();
}
