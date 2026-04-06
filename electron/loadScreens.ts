const createDataPage = (title: string, subtitle: string, body: string) => {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Space Grotesk", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(201, 133, 72, 0.2), transparent 24%),
          linear-gradient(150deg, #110f0c 0%, #191611 44%, #091618 100%);
        color: #f5efdf;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
      }

      main {
        width: min(560px, calc(100vw - 48px));
        padding: 28px;
        border-radius: 28px;
        border: 1px solid rgba(255, 235, 208, 0.12);
        background: rgba(20, 18, 15, 0.84);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
      }

      .eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 0.72rem;
        color: #cfb48a;
      }

      h1 {
        margin: 12px 0 8px;
        font: 600 2rem/1 "Iowan Old Style", "Palatino Linotype", serif;
      }

      p {
        margin: 0;
        color: #b7aa93;
        line-height: 1.7;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <main>
      <span class="eyebrow">${subtitle}</span>
      <h1>${title}</h1>
      <p>${body}</p>
    </main>
  </body>
</html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
};

export const createSplashScreenUrl = () =>
  createDataPage(
    "Preparing secure workspace",
    "DejAzmach desktop shell",
    "Loading the renderer behind an isolated Electron boundary.\nPermissions, webviews, downloads, and unexpected navigation stay denied until explicit app support exists."
  );

export const createLoadFailureUrl = (detail: string) =>
  createDataPage(
    "Desktop shell could not load",
    "Renderer startup failed",
    `${detail}\n\nThe app stayed inside the secure shell instead of opening a partial or unsafe view.`
  );
