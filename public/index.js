// Global state
let currentFriend = null;
let currentScreenshot = null;
let friendsData = [];
let screenshotsData = [];

// Favorites functions
function getFavorites() {
    try {
        const favorites = localStorage.getItem('findmy-favorites');
        return favorites ? JSON.parse(favorites) : [];
    } catch (e) {
        console.error('Error loading favorites:', e);
        return [];
    }
}

function saveFavorites(favorites) {
    try {
        localStorage.setItem('findmy-favorites', JSON.stringify(favorites));
    } catch (e) {
        console.error('Error saving favorites:', e);
    }
}

function calculateSimilarity(str1, str2) {
    // Simple character-based similarity calculation
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    // Count matching characters in order
    let matches = 0;
    let shorterIndex = 0;
    
    for (let i = 0; i < longer.length && shorterIndex < shorter.length; i++) {
        if (longer[i].toLowerCase() === shorter[shorterIndex].toLowerCase()) {
            matches++;
            shorterIndex++;
        }
    }
    
    return matches / longer.length;
}

function isFavorite(friendName) {
    const favorites = getFavorites();
    return favorites.some(fav => calculateSimilarity(fav, friendName) >= 0.8);
}

function toggleFavorite(friendName) {
    let favorites = getFavorites();
    
    // Check if already favorited (with fuzzy matching)
    const existingIndex = favorites.findIndex(fav => calculateSimilarity(fav, friendName) >= 0.8);
    
    if (existingIndex >= 0) {
        // Remove from favorites
        favorites.splice(existingIndex, 1);
    } else {
        // Add to favorites
        favorites.push(friendName);
    }
    
    saveFavorites(favorites);
    
    // Re-render the friends list to update star states and sorting
    renderFriendsList();
}

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

function updateFavoriteButton() {
    const favoriteBtn = document.getElementById('favorite-btn');
    if (!currentFriend) return;
    
    const isFav = isFavorite(currentFriend.name);
    
    if (isFav) {
        favoriteBtn.textContent = 'Remove from Favorites';
        favoriteBtn.style.backgroundColor = '#dc3545';
        favoriteBtn.style.color = 'white';
    } else {
        favoriteBtn.textContent = 'Add to Favorites';
        favoriteBtn.style.backgroundColor = '#ffc107';
        favoriteBtn.style.color = 'black';
    }
}

function toggleCurrentFavorite() {
    if (!currentFriend) return;
    
    toggleFavorite(currentFriend.name);
    updateFavoriteButton();
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

    // Separate favorites from non-favorites while preserving original order
    const favorites = friendsData.filter(friend => isFavorite(friend.name));
    const nonFavorites = friendsData.filter(friend => !isFavorite(friend.name));
    
    // Concatenate: favorites first, then non-favorites (both in original order)
    const sortedFriends = [...favorites, ...nonFavorites];

    const selectedFriend = document.getElementById('selected-friend').textContent;
    
    container.innerHTML = sortedFriends.map(friend => {
        const isSelected = friend.name === selectedFriend;
        const isFav = isFavorite(friend.name);
        const selectedIndicator = isSelected ? ' ✓ ' : '';
        
        let classes = 'friend-item';
        if (isFav) classes += ' favorite';
        if (isSelected) classes += ' selected';
        
        return `
            <div class="${classes}" onclick="showFriendDetail('${friend.name}')">
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
    
    // Update favorite button
    updateFavoriteButton();
    
    // Load screenshot if available
    loadFriendScreenshot();
    
    // Update selected status
    updateFriendSelectedStatus();
}

function showFriendsList() {
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
        
        selectBtn.textContent = isSelected ? 'Re-select Friend' : 'Select Friend';
        selectBtn.disabled = false; // Never disable - allow re-selection
        
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
        
        // Refresh the friends list to update selected status everywhere
        await loadFriends();
        
        // Update the local status as well
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

async function screenshotAllFriends() {
    const screenshotBtn = document.getElementById('screenshot-all-btn');
    screenshotBtn.disabled = true;
    screenshotBtn.textContent = 'Taking Screenshots...';
    
    try {
        showStatus('screenshots-task-status', 'Starting to take screenshots of all friends...', 'loading');
        
        // Start the async task
        const startResult = await apiCall('/api/screenshot_all', { method: 'POST' });
        
        showStatus('screenshots-task-status', startResult.message + ' (This may take a few minutes)', 'loading');
        
        // Wait for task completion
        const result = await waitForTask(startResult.task_id);
        
        if (result.status === 'completed') {
            const results = result.result;
            const successful = Object.keys(results).filter(name => results[name].error === null).length;
            const failed = Object.keys(results).length - successful;
            
            let message = `Screenshots completed! ${successful} successful`;
            if (failed > 0) {
                message += `, ${failed} failed`;
            }
            
            showStatus('screenshots-task-status', message, 'success');
            
            // Show details of failed screenshots
            if (failed > 0) {
                const failedFriends = Object.keys(results).filter(name => results[name].error !== null);
                console.log('Failed screenshots:', failedFriends.map(name => `${name}: ${results[name].error}`));
            }
        } else {
            showStatus('screenshots-task-status', `Screenshot task failed: ${result.error}`, 'error');
        }
        
        // Reload screenshots list to show new screenshots
        await loadScreenshots();
        
        setTimeout(() => hideStatus('screenshots-task-status'), 5000);
        
    } catch (error) {
        showStatus('screenshots-task-status', `Screenshot all failed: ${error.message}`, 'error');
    } finally {
        screenshotBtn.disabled = false;
        screenshotBtn.textContent = 'Screenshot All Friends';
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
    loadFriends();
});
