document.addEventListener('DOMContentLoaded', () => {
  // Set active navigation link based on current URL
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('.nav-link');
  
  navLinks.forEach(link => {
    if (link.getAttribute('href') === currentPath) {
      link.classList.add('active');
    }
  });
  
  // Add time validation for start and end times
  const jamMulaiInput = document.getElementById('jam_mulai');
  const jamSelesaiInput = document.getElementById('jam_selesai');
  
  if (jamMulaiInput && jamSelesaiInput) {
    const validateTimes = () => {
      if (jamMulaiInput.value && jamSelesaiInput.value) {
        if (jamMulaiInput.value >= jamSelesaiInput.value) {
          jamSelesaiInput.setCustomValidity('Jam selesai harus lebih lambat dari jam mulai');
        } else {
          jamSelesaiInput.setCustomValidity('');
        }
      }
    };
    
    jamMulaiInput.addEventListener('change', validateTimes);
    jamSelesaiInput.addEventListener('change', validateTimes);
  }
}); 