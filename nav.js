// Mobile navigation toggle
document.addEventListener('DOMContentLoaded', function () {
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');

  if (toggle && links) {
    toggle.addEventListener('click', function () {
      links.classList.toggle('open');
      // Accessibility: toggle aria-expanded
      const expanded = links.classList.contains('open');
      toggle.setAttribute('aria-expanded', expanded);
    });

    // Close menu when a link is clicked (mobile)
    links.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        links.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }
});
