// =================================================================
// MCRM - Ortak Uygulama Fonksiyonları
// =================================================================

// --- Global State & Auth ---
let authToken = localStorage.getItem('authToken');
let currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');

function checkAuth() {
    if (!authToken && !window.location.pathname.endsWith('index.html') && window.location.pathname !== '/') {
        window.location.href = '/';
    }
}

function logout() {
    if (confirm('Çıkış yapmak istediğinizden emin misiniz?')) {
        localStorage.removeItem('authToken');
        localStorage.removeItem('currentUser');
        window.location.href = '/';
    }
}

// --- API Çağrıları ---
async function apiCall(url, options = {}) {
    try {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }

        const response = await fetch(url, {
            ...options,
            headers: headers,
            cache: 'reload' // 304 Not Modified hatasını önlemek için önbelleği atla
        });

        if (!response.ok) {
            let errorMessage = `API hatası: ${response.status}`;
            try {
                const errorData = await response.json();
                errorMessage = errorData.message || errorData.error || errorMessage;
            } catch (e) {
                errorMessage = await response.text();
            }
            throw new Error(errorMessage);
        }
        return response.json();
    } catch (error) {
        console.error(`API çağrısı başarısız (${url}):`, error);
        throw error;
    }
}

// --- Mobil Menü ---
function toggleMobileMenu() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.mobile-overlay');
    const toggleBtn = document.querySelector('.mobile-menu-toggle');
    
    sidebar.classList.toggle('mobile-open');
    overlay.classList.toggle('active');
    if (toggleBtn) {
        toggleBtn.classList.toggle('active');
        toggleBtn.innerHTML = toggleBtn.classList.contains('active') ? '&times;' : '☰';
    }
}

function closeMobileMenu() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.mobile-overlay');
    const toggleBtn = document.querySelector('.mobile-menu-toggle');
    
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('active');
    if (toggleBtn) {
        toggleBtn.classList.remove('active');
        toggleBtn.innerHTML = '☰';
    }
}

// --- Profil Menüsü ---
function toggleProfileMenu(element) {
    const widget = element.closest('.user-profile-widget');
    widget.classList.toggle('open');
    widget.querySelector('.user-profile-menu').style.display = widget.classList.contains('open') ? 'block' : 'none';
}

function updateDateTime() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('tr-TR');
    const timeStr = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    
    const userNameEl = document.getElementById('userName');
    const dateTimeEl = document.getElementById('currentDateTime');
    
    if (userNameEl && currentUser) {
        userNameEl.textContent = `${currentUser.full_name || 'Kullanıcı'} (${currentUser.role_name || 'Rol Yok'})`;
    }
    if (dateTimeEl) dateTimeEl.textContent = `${dateStr} - ${timeStr}`;
}

function openProfile() {
    const modal = document.getElementById('profileModal');
    if (modal && currentUser) {
        document.getElementById('profile_full_name').value = currentUser.full_name || '';
        document.getElementById('profile_email').value = currentUser.email || '';
        modal.style.display = 'block';
    }
    toggleProfileMenu();
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
}

// --- Genel Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    if (authToken) {
        updateDateTime();
        setInterval(updateDateTime, 30000);
        document.querySelectorAll('.sidebar a').forEach(link => link.addEventListener('click', closeMobileMenu));
    }
});