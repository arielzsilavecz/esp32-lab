const form = document.getElementById('login-form');
const errorEl = document.getElementById('error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.hidden = true;

  const data = new FormData(form);
  const button = form.querySelector('button');
  button.disabled = true;

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: data.get('email'),
        password: data.get('password'),
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      errorEl.textContent = body.error || 'No se pudo iniciar sesion';
      errorEl.hidden = false;
      return;
    }

    window.location.href = '/';
  } finally {
    button.disabled = false;
  }
});
