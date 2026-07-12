export function LoginPage(props: { error?: string }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Log in · Budget Tracker</title>
        <link rel="stylesheet" href="/public/css/style.css" />
      </head>
      <body>
        <div class="auth-page">
          <form method="post" action="/login" class="auth-card">
            <h1>Budget Tracker</h1>
            {props.error && (
              <p class="error" safe>
                {props.error}
              </p>
            )}
            <label>
              Username
              <input type="text" name="username" autocomplete="username" required autofocus />
            </label>
            <label>
              Password
              <input type="password" name="password" autocomplete="current-password" required />
            </label>
            <button type="submit">Log in</button>
          </form>
        </div>
      </body>
    </html>
  );
}
