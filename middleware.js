import { NextResponse } from "next/server";

export function middleware(request) {
  const user = process.env.DASHBOARD_USER;
  const password = process.env.DASHBOARD_PASSWORD;
  const authorization = request.headers.get("authorization");

  if (!user || !password) {
    return new NextResponse("Configuration manquante", {
      status: 500,
    });
  }

  const expected = `Basic ${btoa(`${user}:${password}`)}`;

  if (authorization !== expected) {
    return new NextResponse("Authentification requise", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Site Monitor"',
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
