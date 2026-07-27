document.addEventListener('DOMContentLoaded', function () {

  // ---------- mobile nav toggle ----------
  var mobileBtn = document.querySelector('.mobile-navbar-btn');
  var header = document.querySelector('.header');
  function toggleNavbar() {
    header.classList.toggle('active');
  }
  if (mobileBtn && header) {
    mobileBtn.addEventListener('click', function () { toggleNavbar(); });
    document.querySelectorAll('.navbar-link').forEach(function (link) {
      link.addEventListener('click', function () { header.classList.remove('active'); });
    });
  }

  // ---------- image slider (fade + dots + arrows + autoplay) ----------
  var slideIndex = 1;
  var slideTimer = null;

  function showSlides(n) {
    var slides = document.getElementsByClassName('mySlides');
    var dots = document.getElementsByClassName('dot');
    if (!slides.length) return;

    if (n > slides.length) { slideIndex = 1; }
    if (n < 1) { slideIndex = slides.length; }

    for (var i = 0; i < slides.length; i++) { slides[i].style.display = 'none'; }
    for (var j = 0; j < dots.length; j++) { dots[j].className = dots[j].className.replace(' active', ''); }

    slides[slideIndex - 1].style.display = 'block';
    if (dots[slideIndex - 1]) { dots[slideIndex - 1].className += ' active'; }
  }

  window.plusSlides = function (n) {
    resetAutoplay();
    showSlides(slideIndex += n);
  };

  window.currentSlide = function (n) {
    resetAutoplay();
    showSlides(slideIndex = n);
  };

  function autoAdvance() { showSlides(slideIndex += 1); }

  function resetAutoplay() {
    if (slideTimer) clearInterval(slideTimer);
    slideTimer = setInterval(autoAdvance, 5500);
  }

  showSlides(slideIndex);
  resetAutoplay();

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

});
