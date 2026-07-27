const mobile_nav = document.querySelector(".mobile-navbar-btn");
const nav_header = document.querySelector(".header");
const toggleNavbar = () => {
  nav_header.classList.toggle("active");
};
mobile_nav.addEventListener("click", () => toggleNavbar());

document.querySelectorAll(".navbar-link").forEach(function (link) {
  link.addEventListener("click", function () {
    nav_header.classList.remove("active");
  });
});

// ---------- reveal-on-scroll ----------
var revealEls = document.querySelectorAll('[data-reveal]');
if ('IntersectionObserver' in window) {
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealEls.forEach(function (el) { observer.observe(el); });
} else {
  revealEls.forEach(function (el) { el.classList.add('is-visible'); });
}

// ---------- scroll-to-top button ----------
var topBtn = document.querySelector('.top');
window.addEventListener('scroll', function () {
  if (topBtn) topBtn.classList.toggle('is-visible', window.scrollY > 400);
});
  // footer year
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();