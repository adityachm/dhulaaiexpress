/* ============================================================
   DHULAAI EXPRESS — Main JavaScript
   Theme Toggle · Scroll Reveal · Smooth Scroll · Nav Scroll
   ============================================================ */

(function () {
  'use strict';

  /* ── THEME ── */
  const THEME_KEY = 'dhulaai-theme';
  const root = document.documentElement;
  const toggleBtn = document.getElementById('theme-toggle');
  const toggleIcon = document.getElementById('theme-icon');

  const ICONS = {
    dark:  '☀',   // clicking this switches to light
    light: '☾'    // clicking this switches to dark
  };

  function getStoredTheme() {
    return localStorage.getItem(THEME_KEY) || 'dark';
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    if (toggleIcon) toggleIcon.textContent = ICONS[theme];
    localStorage.setItem(THEME_KEY, theme);
  }

  function toggleTheme() {
    const current = root.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  // Initialise on load
  applyTheme(getStoredTheme());
  if (toggleBtn) toggleBtn.addEventListener('click', toggleTheme);


  /* ── SCROLL REVEAL ── */
  const revealEls = document.querySelectorAll('.reveal');

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  revealEls.forEach(el => revealObserver.observe(el));


  /* ── SMOOTH SCROLL ── */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });


  /* ── NAV SCROLL EFFECT ── */
  const nav = document.querySelector('.nav');

  function onScroll() {
    if (!nav) return;
    if (window.scrollY > 50) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // run once on load


  /* ── ACTIVE NAV LINK ── */
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-links a');

  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute('id');
        navLinks.forEach(link => {
          link.classList.remove('active');
          if (link.getAttribute('href') === `#${id}`) {
            link.classList.add('active');
          }
        });
      }
    });
  }, { threshold: 0.4 });

  sections.forEach(s => sectionObserver.observe(s));


  /* ── HERO LOGO PARALLAX ── */
  const heroLogo = document.querySelector('.hero-logo');

  if (heroLogo) {
    window.addEventListener('scroll', () => {
      const scrollY = window.scrollY;
      if (scrollY < window.innerHeight) {
        heroLogo.style.transform = `translateY(${scrollY * 0.08}px)`;
      }
    }, { passive: true });
  }


  /* ── PACKAGE CARD TILT (subtle 3D on hover) ── */
  document.querySelectorAll('.pkg').forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * 8;
      const y = ((e.clientY - rect.top) / rect.height - 0.5) * -8;
      card.style.transform = `translateY(-10px) rotateX(${y}deg) rotateY(${x}deg)`;
      card.style.transition = 'transform 0.05s linear';
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
      card.style.transition = 'all 0.35s cubic-bezier(0.4,0,0.2,1)';
    });
  });


  /* ── WHATSAPP FORM SUBMIT ── */
  const formSubmit = document.getElementById('form-submit');

  if (formSubmit) {
    formSubmit.addEventListener('click', function (e) {
      e.preventDefault();

      const name    = document.getElementById('f-name')?.value.trim() || '';
      const phone   = document.getElementById('f-phone')?.value.trim() || '';
      const car     = document.getElementById('f-car')?.value.trim() || '';
      const service = document.getElementById('f-service')?.value || '';
      const timing  = document.getElementById('f-timing')?.value.trim() || '';

      if (!name || !phone) {
        showToast('Please enter your name and phone number.');
        return;
      }

      const message = encodeURIComponent(
        `Hello Dhulaai Express! I'd like to book an appointment.\n\n` +
        `Name: ${name}\n` +
        `Phone: ${phone}\n` +
        `Car: ${car}\n` +
        `Service: ${service}\n` +
        `Preferred Time: ${timing}`
      );

      window.open(`https://wa.me/919149292076?text=${message}`, '_blank');
    });
  }


  /* ── TOAST NOTIFICATION ── */
  function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 400);
    }, 3200);
  }

  // Toast styles — injected via JS
  const toastStyle = document.createElement('style');
  toastStyle.textContent = `
    .toast {
      position: fixed;
      bottom: 100px; left: 50%;
      transform: translateX(-50%) translateY(10px);
      background: rgba(26,86,219,0.95);
      color: #fff;
      font-family: 'Montserrat', sans-serif;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 1px;
      padding: 12px 28px;
      border-radius: 6px;
      border: 1px solid rgba(75,142,245,0.4);
      z-index: 9999;
      opacity: 0;
      transition: opacity 0.35s, transform 0.35s;
      backdrop-filter: blur(12px);
      white-space: nowrap;
      pointer-events: none;
    }
  `;
  document.head.appendChild(toastStyle);

  // Nav scrolled style
  const navStyle = document.createElement('style');
  navStyle.textContent = `
    .nav.scrolled {
      height: 66px;
      box-shadow: 0 4px 40px rgba(0,0,0,0.3);
    }
    .nav-links a.active { color: var(--white); }
    .nav-links a.active::after { transform: scaleX(1); }
  `;
  document.head.appendChild(navStyle);

})();
