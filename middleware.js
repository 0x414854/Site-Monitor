import { NextResponse } from "next/server";

function safeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;

  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

function unauthorized() {
  return new NextResponse("Authentification requise", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Site Monitor"',
      "Cache-Control": "no-store",
    },
  });
}

export function middleware(request) {
  const user = process.env.DASHBOARD_USER;
  const password = process.env.DASHBOARD_PASSWORD;

  if (!user || !password || user.includes(":")) {
    return new NextResponse("Configuration manquante", {
      status: 500,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Basic ")) {
    return unauthorized();
  }

  let providedCredentials;

  try {
    providedCredentials = atob(authorization.slice(6));
  } catch {
    return unauthorized();
  }

  const separator = providedCredentials.indexOf(":");

  if (separator < 0) {
    return unauthorized();
  }

  const providedUser = providedCredentials.slice(0, separator);
  const providedPassword = providedCredentials.slice(separator + 1);

  if (
    !safeEqual(providedUser, user) ||
    !safeEqual(providedPassword, password)
  ) {
    return unauthorized();
  }

  const response = NextResponse.next();

  response.headers.set("Cache-Control", "no-store");

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
