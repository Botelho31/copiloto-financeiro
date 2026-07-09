export function SetupPage(props: { error?: string }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Setup · Budget Tracker</title>
        <link rel="stylesheet" href="/public/css/style.css" />
      </head>
      <body>
        <div class="auth-page">
          <form method="post" action="/setup" class="auth-card">
            <h1>Welcome</h1>
            <p class="muted">Create the admin account. This is the only account this app supports.</p>
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
              <input
                type="password"
                name="password"
                autocomplete="new-password"
                minlength="8"
                required
              />
            </label>
            <button type="submit">Create account</button>
          </form>
        </div>
      </body>
    </html>
  );
}
