// Silent Anypoint re-login for the desktop app. Posts to the local Next server so
// Set-Cookie is applied to the Electron session automatically.

const { net, session } = require("electron");

const REFRESH_BUFFER_MS = 10 * 60 * 1000;
const DEFAULT_EXPIRES_IN_MS = 3600 * 1000;

/**
 * @param {number} port
 * @param {{ username: string; password: string; region: string }} credentials
 * @returns {Promise<{ ok: true; expiresAt: number }>}
 */
function loginViaLocalServer(port, credentials) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      username: credentials.username,
      password: credentials.password,
      region: credentials.region,
    });

    const request = net.request({
      method: "POST",
      url: `http://127.0.0.1:${port}/api/auth/password-login`,
      session: session.defaultSession,
    });

    request.setHeader("Content-Type", "application/json");
    request.setHeader("Content-Length", Buffer.byteLength(body));

    let responseBody = "";
    request.on("response", (response) => {
      response.on("data", (chunk) => {
        responseBody += chunk.toString();
      });
      response.on("end", () => {
        const status = response.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          let expiresAt = Date.now() + DEFAULT_EXPIRES_IN_MS;
          try {
            const data = JSON.parse(responseBody);
            if (typeof data.expiresAt === "number" && data.expiresAt > Date.now()) {
              expiresAt = data.expiresAt;
            }
          } catch {
            /* use default */
          }
          resolve({ ok: true, expiresAt });
          return;
        }

        let message = `Sign-in failed (${status})`;
        try {
          const data = JSON.parse(responseBody);
          if (data.error) message = data.error;
        } catch {
          /* ignore */
        }
        reject(new Error(message));
      });
    });

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

/** Remove the iron-session cookie from the Electron session jar. */
async function clearSessionCookie(port) {
  await session.defaultSession.cookies.remove(`http://localhost:${port}`, "ant_session");
}

module.exports = {
  REFRESH_BUFFER_MS,
  DEFAULT_EXPIRES_IN_MS,
  loginViaLocalServer,
  clearSessionCookie,
};
