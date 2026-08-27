import * as bcrypt from 'bcryptjs'
import { GenerateToken, Delay } from "./helpers"
import { Env } from "./interfaces"
import { version } from "./variables"

// How long an admin session token stays valid after login (in seconds).
const TOKEN_TTL_SECONDS: number = 60 * 60 * 12 // 12 hours
// Failed-attempt lockout window, keyed by client IP.
const MAX_FAILED_ATTEMPTS: number = 5
const LOCKOUT_WINDOW_SECONDS: number = 60 * 15 // 15 minutes

export async function GetLogin(request: Request, env: Env): Promise<Response> {
  const url: URL = new URL(request.url)
  let htmlMessage = ""
  const message = url.searchParams.get("message")
  if (message == "error") {
    htmlMessage = `<div class="p-3 bg-danger text-white fw-bold text-center">Invalid password / کلمه عبور معتبر نمی‌باشد!</div>`
  }

  const htmlContent = `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf8" />
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.1/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-4bw+/aepP/YC94hEpVNVgiZdgIC5+VKNBQNGCHeKRQN+PtmoHDEXuppvnDJzQIu9" crossorigin="anonymous">
    </head>
    <body dir="ltr">
      <div class="container border p-0">
        <div class="p-3 bg-primary text-white">
          <div class="text-nowrap fs-4 fw-bold text-center">V2RAY Worker - Control Panel</div>
          <div class="text-nowrap fs-6 text-center">
            Version ${version}
          </div>
        </div>
        ${htmlMessage}
        <form class="mt-5 p-3 row g-3" method="post">
          <div class="col-auto">
            Enter password / کلمه‌ی عبور را وارد کنید:
          </div>
          <div class="col-auto">
            <label for="inputPassword2" class="visually-hidden">Password</label>
            <input type="password" class="form-control" id="inputPassword2" placeholder="Password" name="password" minlength="6" required>
          </div>
          <div class="col-auto">
            <button type="submit" class="btn btn-primary mb-3">Confirm identity / تایید هویت</button>
          </div>
        </form>
      </div>
    </body>
  </html>
  `

  return new Response(htmlContent, {
    headers: {"Content-Type": "text/html"},
  })
}

export async function PostLogin(request: Request, env: Env): Promise<Response> {
  const url: URL = new URL(request.url)
  const clientIP: string = request.headers.get("cf-connecting-ip") || "unknown"
  const attemptsKey: string = `LoginAttempts:${clientIP}`

  await Delay(1000)

  // Simple IP-based lockout: after MAX_FAILED_ATTEMPTS failures within the window,
  // reject outright without even checking the password. This is KV-based (not
  // perfectly atomic under concurrent requests) but is a meaningful deterrent against
  // naive brute-forcing, which previously had no protection beyond the flat 1s delay.
  const attemptsRaw: string | null = await env.settings.get(attemptsKey)
  const attempts: number = attemptsRaw ? parseInt(attemptsRaw) : 0
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    return Response.redirect(`${url.protocol}//${url.hostname}${url.port != "443" ? ":" + url.port : ""}/login?message=error`, 302)
  }

  const formData = await request.formData()
  const password: string = (formData.get("password")?.toString()) || ""
  let hashedPassword: string = await env.settings.get("Password") || ""

  const match = await bcrypt.compare(password, hashedPassword)

  if (match) {
    await env.settings.delete(attemptsKey)
    const token: string = GenerateToken(24)
    await env.settings.put("Token", token, { expirationTtl: TOKEN_TTL_SECONDS })
    return Response.redirect(`${url.protocol}//${url.hostname}${url.port != "443" ? ":" + url.port : ""}/?token=${token}`, 302)
  }

  await env.settings.put(attemptsKey, (attempts + 1).toString(), { expirationTtl: LOCKOUT_WINDOW_SECONDS })
  return Response.redirect(`${url.protocol}//${url.hostname}${url.port != "443" ? ":" + url.port : ""}/login?message=error`, 302)
}
