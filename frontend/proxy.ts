import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = Boolean(request.cookies.get("certflow_session")?.value);
  // A cookie's presence is only an optimistic check. Let the login page load
  // even with an expired cookie so a fresh login can replace it.
  // The product site is intentionally public. All console routes still require
  // a session and preserve the destination for a post-login return.
  if (pathname === "/" || pathname === "/login" || pathname === "/register") return NextResponse.next();
  if (!signedIn) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!api|_next|favicon.ico).*)"] };
