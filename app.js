// Password visibility toggle
function togglePassword(inputId) {
    const input = document.getElementById(inputId);
    const type = input.type === 'password' ? 'text' : 'password';
    input.type = type;
}

// Email validation function
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
    return emailRegex.test(email);
}

// Username validation function - only letters, numbers, and underscore
function isValidUsername(username) {
    const usernameRegex = /^[a-zA-Z0-9_]+$/;
    return usernameRegex.test(username) && username.length >= 3;
}

let currentUser = null;
let selectedContact = null;
let messagePolling = null;
let selectedFile = null;
let typingTimeout = null;
let isTyping = false;
let lastTypingNotification = 0;
let verificationAttempts = 0;
let verificationToken = null;
let pendingEmail = null;
let registrationData = null;

// Prevent refresh/close during verification
window.addEventListener('beforeunload', function (e) {
    if (document.getElementById('verificationModal').classList.contains('active')) {
        e.preventDefault();
        e.returnValue = 'You are in the middle of email verification. If you leave, you will need to register again.';
        return e.returnValue;
    }
});

// Modal functions
function openImageModal(imageSrc) {
    document.getElementById('modalImage').src = imageSrc;
    document.getElementById('imageModal').classList.add('active');
}

function closeModal() {
    document.getElementById('imageModal').classList.remove('active');
}

function openProfileModal(user) {
    const pictureContainer = document.getElementById('profileModalPictureContainer');
    
    if (user.profile_picture) {
        pictureContainer.innerHTML = `<img src="${user.profile_picture}" class="profile-modal-picture" onclick="openImageModal('${user.profile_picture}')" />`;
    } else {
        pictureContainer.innerHTML = `<div class="profile-modal-picture-placeholder">${user.username[0].toUpperCase()}</div>`;
    }
    
    document.getElementById('profileModalUsername').textContent = user.username;
    document.getElementById('profileModalBio').textContent = user.bio || 'No bio yet';
    document.getElementById('profileModal').classList.add('active');
}

function closeProfileModal(event) {
    if (!event || event.target.id === 'profileModal') {
        document.getElementById('profileModal').classList.remove('active');
    }
}

// Typing indicator
async function notifyTyping() {
    if (!selectedContact) return;
    
    const now = Date.now();
    // Only send typing notification every 2 seconds
    if (now - lastTypingNotification > 2000) {
        lastTypingNotification = now;
        
        try {
            await fetch('/typing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: selectedContact.id })
            });
        } catch (error) {
            console.error('Failed to send typing notification:', error);
        }
    }
    
    if (!isTyping) {
        isTyping = true;
    }
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        isTyping = false;
    }, 1000);
}

function switchAuthTab(tab) {
    const tabs = document.querySelectorAll('.auth-screen .tab-btn');
    const forms = document.querySelectorAll('.auth-form');
    
    tabs.forEach(t => t.classList.remove('active'));
    forms.forEach(f => f.classList.remove('active'));
    
    event.target.classList.add('active');
    document.getElementById(tab + 'Form').classList.add('active');
    
    document.getElementById('loginError').textContent = '';
    document.getElementById('registerError').textContent = '';
    document.getElementById('registerSuccess').textContent = '';
}

function switchSidebarTab(tab) {
    const tabs = document.querySelectorAll('.sidebar-tab');
    const panels = document.querySelectorAll('.tab-panel');
    
    tabs.forEach(t => t.classList.remove('active'));
    panels.forEach(p => p.classList.remove('active'));
    
    event.target.classList.add('active');
    document.getElementById(tab + 'Panel').classList.add('active');
    
    if (tab === 'users') loadAllUsers();
    else if (tab === 'profile') loadProfile();
    else if (tab === 'chats') loadContacts();
}

async function register() {
    const username = document.getElementById('registerUsername').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const errorEl = document.getElementById('registerError');
    const successEl = document.getElementById('registerSuccess');
    
    errorEl.textContent = '';
    successEl.textContent = '';

    if (!username || !email || !password) {
        errorEl.textContent = 'All fields are required';
        return;
    }

    // Username validation - only letters, numbers, and underscore
    if (!isValidUsername(username)) {
        errorEl.textContent = 'Username must be at least 3 characters and contain only letters, numbers, and underscores (_). No spaces or special characters allowed!';
        return;
    }

    // Email validation
    if (!isValidEmail(email)) {
        errorEl.textContent = 'Please enter a valid email address (e.g., user@example.com)';
        return;
    }

    // Password validation
    if (password.length < 6) {
        errorEl.textContent = 'Password must be at least 6 characters long';
        return;
    }

    // Store registration data temporarily
    registrationData = { username, email, password };

    try {
        const response = await fetch('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });

        const data = await response.json();

        if (response.ok) {
            // Show verification modal
            verificationToken = data.verificationToken;
            pendingEmail = email;
            verificationAttempts = 0;
            document.getElementById('verificationEmail').textContent = email;
            document.getElementById('verificationCode').value = '';
            document.getElementById('verificationModal').classList.add('active');
            document.getElementById('attemptsLeft').textContent = 'Attempts remaining: 3';
            successEl.textContent = 'Please check your email for the verification code';
        } else {
            errorEl.textContent = data.error || 'Registration failed';
        }
    } catch (error) {
        errorEl.textContent = 'Network error';
    }
}

async function verifyCode() {
    const code = document.getElementById('verificationCode').value.trim();
    const errorEl = document.getElementById('verificationError');
    
    errorEl.textContent = '';

    if (!code || code.length !== 6) {
        errorEl.textContent = 'Please enter the 6-digit code';
        return;
    }

    verificationAttempts++;

    if (verificationAttempts > 3) {
        errorEl.textContent = 'Too many incorrect attempts. The code has been invalidated. Please register again.';
        setTimeout(() => {
            document.getElementById('verificationModal').classList.remove('active');
            verificationToken = null;
            verificationAttempts = 0;
            registrationData = null;
            // Clear the registration form
            document.getElementById('registerUsername').value = '';
            document.getElementById('registerEmail').value = '';
            document.getElementById('registerPassword').value = '';
        }, 3000);
        return;
    }

    try {
        const response = await fetch('/verify-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                code: code,
                token: verificationToken,
                attempts: verificationAttempts
            })
        });

        const data = await response.json();

        if (response.ok) {
            currentUser = data;
            document.getElementById('verificationModal').classList.remove('active');
            registrationData = null;
            showMessenger();
        } else {
            errorEl.textContent = data.error || 'Invalid code';
            const attemptsRemaining = 3 - verificationAttempts;
            document.getElementById('attemptsLeft').textContent = `Attempts remaining: ${attemptsRemaining}`;
            
            if (attemptsRemaining === 0) {
                errorEl.textContent = 'Too many incorrect attempts. Please register again.';
                setTimeout(() => {
                    document.getElementById('verificationModal').classList.remove('active');
                    verificationToken = null;
                    verificationAttempts = 0;
                    registrationData = null;
                    // Clear the registration form
                    document.getElementById('registerUsername').value = '';
                    document.getElementById('registerEmail').value = '';
                    document.getElementById('registerPassword').value = '';
                }, 3000);
            }
        }
    } catch (error) {
        errorEl.textContent = 'Network error';
    }
}

async function login() {
    const usernameOrEmail = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    
    errorEl.textContent = '';

    if (!usernameOrEmail || !password) {
        errorEl.textContent = 'Username/Email and password required';
        return;
    }

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernameOrEmail, password })
        });

        const data = await response.json();

        if (response.ok) {
            currentUser = data;
            showMessenger();
        } else {
            errorEl.textContent = data.error || 'Login failed';
        }
    } catch (error) {
        errorEl.textContent = 'Network error';
    }
}

async function logout() {
    await fetch('/logout', { method: 'POST' });
    if (messagePolling) clearInterval(messagePolling);
    currentUser = null;
    selectedContact = null;
    document.getElementById('authScreen').style.display = 'block';
    document.getElementById('messengerScreen').classList.remove('active');
}

function showMessenger() {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('messengerScreen').classList.add('active');
    document.getElementById('currentUsername').textContent = currentUser.username;
    loadContacts();
    startMessagePolling();
}

async function loadProfile() {
    try {
        const response = await fetch('/me');
        const user = await response.json();
        
        document.getElementById('profileUsername').value = user.username;
        document.getElementById('profileEmail').value = user.email;
        document.getElementById('profileBio').value = user.bio || '';
        
        const container = document.getElementById('profilePictureContainer');
        if (user.profile_picture) {
            container.innerHTML = `<img src="${user.profile_picture}" class="profile-picture" onclick="openImageModal('${user.profile_picture}')" style="cursor: pointer;" />`;
        } else {
            container.innerHTML = `<div class="profile-picture-placeholder">👤</div>`;
        }
    } catch (error) {
        console.error('Failed to load profile:', error);
    }
}

async function uploadProfilePicture() {
    const input = document.getElementById('profilePictureInput');
    const file = input.files[0];
    
    if (!file) return;
    
    const formData = new FormData();
    formData.append('profilePicture', file);
    
    try {
        const response = await fetch('/profile/picture', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            const container = document.getElementById('profilePictureContainer');
            container.innerHTML = `<img src="${data.filePath}" class="profile-picture" onclick="openImageModal('${data.filePath}')" />`;
            
            // Update current user's profile picture
            currentUser.profile_picture = data.filePath;
            
            alert('Profile picture updated! It will show in your messages.');
        } else {
            alert('Failed to upload profile picture');
        }
    } catch (error) {
        alert('Failed to upload profile picture');
    }
}

async function saveProfile() {
    const email = document.getElementById('profileEmail').value;
    const bio = document.getElementById('profileBio').value;
    
    // Email validation
    if (!isValidEmail(email)) {
        alert('Please enter a valid email address (e.g., user@example.com)');
        return;
    }
    
    try {
        const response = await fetch('/profile/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, bio })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert('Profile updated successfully!');
        } else {
            alert(data.error || 'Failed to update profile');
        }
    } catch (error) {
        alert('Failed to update profile');
    }
}

async function loadAllUsers() {
    try {
        const response = await fetch('/users');
        const users = await response.json();
        displayUsers(users, 'searchResults');
    } catch (error) {
        console.error('Failed to load users:', error);
    }
}

let searchTimeout;
async function searchUsers() {
    clearTimeout(searchTimeout);
    
    const query = document.getElementById('searchInput').value.trim();
    
    searchTimeout = setTimeout(async () => {
        try {
            // If search is empty, show all users
            if (query === '') {
                await loadAllUsers();
                return;
            }
            
            const response = await fetch(`/users/search?q=${encodeURIComponent(query)}`);
            const users = await response.json();
            displayUsers(users, 'searchResults');
        } catch (error) {
            console.error('Search failed:', error);
        }
    }, 300);
}

function displayUsers(users, containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    if (users.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No users found</div>';
        return;
    }
    
    users.forEach(user => {
        const contactDiv = document.createElement('div');
        contactDiv.className = 'contact-item';
        
        const avatarHtml = user.profile_picture 
            ? `<img src="${user.profile_picture}" class="contact-avatar" onclick="event.stopPropagation(); openProfileModal(${JSON.stringify(user).replace(/"/g, '&quot;')})" />`
            : `<div class="contact-avatar-placeholder" onclick="event.stopPropagation(); openProfileModal(${JSON.stringify(user).replace(/"/g, '&quot;')})">${user.username[0].toUpperCase()}</div>`;
        
        contactDiv.onclick = () => {
            if (containerId === 'searchResults') {
                switchSidebarTab('chats');
                setTimeout(() => selectContact(user), 100);
            } else {
                selectContact(user);
            }
        };
        
        let unreadBadge = '';
        if (user.unread_count && user.unread_count > 0) {
            unreadBadge = `<div class="unread-badge">${user.unread_count}</div>`;
        }
        
        let bioOrTyping = `<div class="contact-bio">${user.bio || 'No bio yet'}</div>`;
        if (user.is_typing) {
            bioOrTyping = `<div class="contact-typing">Typing...</div>`;
        }
        
        contactDiv.innerHTML = `
            ${avatarHtml}
            <div class="contact-info">
                <div class="contact-name">${user.username}</div>
                ${bioOrTyping}
            </div>
            ${unreadBadge}
        `;
        container.appendChild(contactDiv);
    });
}

async function loadContacts() {
    try {
        const response = await fetch('/users');
        const users = await response.json();
        displayUsers(users, 'contactsList');
    } catch (error) {
        console.error('Failed to load contacts:', error);
    }
}

function selectContact(user) {
    selectedContact = user;
    
    const avatarHtml = user.profile_picture 
        ? `<img src="${user.profile_picture}" class="chat-header-avatar" onclick="openProfileModal(${JSON.stringify(user).replace(/"/g, '&quot;')})" />`
        : `<div class="chat-header-avatar-placeholder" onclick="openProfileModal(${JSON.stringify(user).replace(/"/g, '&quot;')})">${user.username[0].toUpperCase()}</div>`;
    
    document.getElementById('chatHeader').innerHTML = `${avatarHtml}<h3>${user.username}</h3>`;
    document.getElementById('messageInputArea').classList.remove('hidden');
    loadMessages();
    
    // Mark messages as read
    markMessagesAsRead(user.id);
}

async function markMessagesAsRead(userId) {
    try {
        await fetch('/messages/mark-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: userId })
        });
    } catch (error) {
        console.error('Failed to mark messages as read:', error);
    }
}

async function loadMessages() {
    if (!selectedContact) return;
    
    try {
        const response = await fetch(`/messages/${selectedContact.id}`);
        const data = await response.json();
        
        const container = document.getElementById('messagesContainer');
        container.innerHTML = '';
        
        if (data.messages.length === 0 && !data.is_typing) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">👋</div>
                    <p>Start a conversation with ${selectedContact.username}</p>
                </div>
            `;
            return;
        }
        
        data.messages.forEach(msg => {
            const isSent = msg.sender_id === currentUser.userId;
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
            
            const time = new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            const avatarUrl = isSent ? (currentUser.profile_picture || null) : msg.sender_picture;
            const avatarInitial = isSent ? currentUser.username[0] : msg.sender_username[0];
            
            const userForProfile = isSent ? currentUser : selectedContact;
            const avatarHtml = avatarUrl 
                ? `<img src="${avatarUrl}" class="message-avatar" onclick="openProfileModal(${JSON.stringify(userForProfile).replace(/"/g, '&quot;')})" />`
                : `<div class="message-avatar-placeholder" onclick="openProfileModal(${JSON.stringify(userForProfile).replace(/"/g, '&quot;')})">${avatarInitial.toUpperCase()}</div>`;
            
            let mediaHtml = '';
            if (msg.file_path) {
                if (msg.file_type === 'image') {
                    mediaHtml = `<div class="message-media"><img src="${msg.file_path}" onclick="openImageModal('${msg.file_path}')" /></div>`;
                } else if (msg.file_type === 'video') {
                    mediaHtml = `<div class="message-media"><video controls><source src="${msg.file_path}" /></video></div>`;
                }
            }
            
            let statusIcon = '';
            if (isSent) {
                statusIcon = msg.is_read ? '✓✓' : '✓';
            }
            
            messageDiv.innerHTML = `
                ${!isSent ? avatarHtml : ''}
                <div class="message-content">
                    <div class="message-bubble">
                        ${msg.message || ''}
                        ${mediaHtml}
                        <div class="message-time">${time} ${statusIcon ? `<span class="message-status">${statusIcon}</span>` : ''}</div>
                    </div>
                </div>
                ${isSent ? avatarHtml : ''}
            `;
            container.appendChild(messageDiv);
        });
        
        // Show typing indicator - WhatsApp style
        if (data.is_typing) {
            const typingDiv = document.createElement('div');
            typingDiv.className = 'typing-message';
            
            const avatarUrl = selectedContact.profile_picture;
            const avatarInitial = selectedContact.username[0];
            
            const avatarHtml = avatarUrl 
                ? `<img src="${avatarUrl}" class="message-avatar-typing" onclick="openProfileModal(${JSON.stringify(selectedContact).replace(/"/g, '&quot;')})" />`
                : `<div class="message-avatar-typing" onclick="openProfileModal(${JSON.stringify(selectedContact).replace(/"/g, '&quot;')})">${avatarInitial.toUpperCase()}</div>`;
            
            typingDiv.innerHTML = `
                ${avatarHtml}
                <div class="message-content">
                    <div class="typing-bubble">
                        Typing...
                    </div>
                </div>
            `;
            container.appendChild(typingDiv);
        }
        
        container.scrollTop = container.scrollHeight;
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

function handleFileSelect() {
    const input = document.getElementById('fileInput');
    const file = input.files[0];
    
    if (!file) return;
    
    selectedFile = file;
    const previewArea = document.getElementById('filePreviewArea');
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const isVideo = file.type.startsWith('video/');
        const mediaHtml = isVideo 
            ? `<video src="${e.target.result}" controls></video>`
            : `<img src="${e.target.result}" />`;
        
        previewArea.innerHTML = `
            <div class="file-preview">
                <div class="file-preview-info">
                    ${mediaHtml}
                    <span>${file.name}</span>
                </div>
                <button class="remove-file-btn" onclick="removeFile()">Remove</button>
            </div>
        `;
    };
    reader.readAsDataURL(file);
}

function removeFile() {
    selectedFile = null;
    document.getElementById('fileInput').value = '';
    document.getElementById('filePreviewArea').innerHTML = '';
}

async function sendMessage() {
    if (!selectedContact) return;
    
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    
    if (!message && !selectedFile) return;
    
    try {
        let response;
        
        if (selectedFile) {
            const formData = new FormData();
            formData.append('to', selectedContact.id);
            formData.append('message', message);
            formData.append('file', selectedFile);
            
            response = await fetch('/send/file', {
                method: 'POST',
                body: formData
            });
        } else {
            response = await fetch('/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: selectedContact.id, message: message })
            });
        }
        
        if (response.ok) {
            input.value = '';
            removeFile();
            loadMessages();
        }
    } catch (error) {
        console.error('Failed to send message:', error);
    }
}

function handleEnter(event) {
    if (event.key === 'Enter') sendMessage();
}

function startMessagePolling() {
    messagePolling = setInterval(async () => {
        if (selectedContact) {
            loadMessages();
        }
        // Reload contacts to update unread counts and typing indicators
        loadContacts();
    }, 1000);
}

window.addEventListener('load', async () => {
    try {
        const response = await fetch('/me');
        if (response.ok) {
            const user = await response.json();
            currentUser = { userId: user.id, username: user.username, profile_picture: user.profile_picture };
            showMessenger();
        }
    } catch (error) {}
});