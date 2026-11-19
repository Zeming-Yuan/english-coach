import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatRouteHash,
  normalizeRoute,
  parseRoute,
  routesEqual,
} from "../lib/router.js";

function readBrowserRoute() {
  if (typeof window === "undefined") return normalizeRoute({ view: "queue" });
  return parseRoute(window.location.hash, window.history.state);
}

export function useAppRoute({ locked = false } = {}) {
  const [route, setRoute] = useState(readBrowserRoute);
  const routeRef = useRef(route);
  const lockedRef = useRef(locked);
  routeRef.current = route;
  lockedRef.current = locked;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.location.hash;
    const expected = formatRouteHash(routeRef.current);
    if (raw && raw !== "#" && raw !== expected) {
      window.history.replaceState(
        {
          ecRoute: true,
          origin: routeRef.current.origin,
          fromHash: window.history.state?.fromHash || null,
        },
        "",
        expected,
      );
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const syncFromBrowser = () => {
      const current = routeRef.current;
      const expectedHash = formatRouteHash(current);
      if (lockedRef.current) {
        if (window.location.hash !== expectedHash) {
          window.history.pushState(
            {
              ecRoute: true,
              origin: current.origin,
              fromHash: window.history.state?.fromHash || null,
            },
            "",
            expectedHash,
          );
        }
        return;
      }
      const next = readBrowserRoute();
      const canonical = formatRouteHash(next);
      if (
        window.location.hash &&
        window.location.hash !== "#" &&
        window.location.hash !== canonical
      ) {
        window.history.replaceState(
          {
            ecRoute: true,
            origin: next.origin,
            fromHash: window.history.state?.fromHash || null,
          },
          "",
          canonical,
        );
      }
      routeRef.current = next;
      setRoute((prev) => (routesEqual(prev, next) ? prev : next));
    };

    window.addEventListener("popstate", syncFromBrowser);
    window.addEventListener("hashchange", syncFromBrowser);
    return () => {
      window.removeEventListener("popstate", syncFromBrowser);
      window.removeEventListener("hashchange", syncFromBrowser);
    };
  }, []);

  const navigate = useCallback(
    (nextInput, { replace = false, popIfFromParent = false } = {}) => {
      if (lockedRef.current) return;
      const prev = routeRef.current;
      const next = normalizeRoute(
        typeof nextInput === "function" ? nextInput(prev) : nextInput,
      );
      if (routesEqual(prev, next) && (typeof window === "undefined" || window.location.hash === formatRouteHash(next))) {
        return;
      }
      const hash = formatRouteHash(next);
      if (
        popIfFromParent &&
        typeof window !== "undefined" &&
        window.history.state?.fromHash === hash
      ) {
        window.history.back();
        return;
      }
      if (typeof window !== "undefined") {
        const prevHash = formatRouteHash(prev);
        if (replace || routesEqual(prev, next)) {
          window.history.replaceState(
            {
              ecRoute: true,
              origin: next.origin,
              fromHash: window.history.state?.fromHash || null,
            },
            "",
            hash,
          );
        } else {
          window.history.pushState(
            { ecRoute: true, origin: next.origin, fromHash: prevHash },
            "",
            hash,
          );
        }
      }
      routeRef.current = next;
      setRoute((current) => (routesEqual(current, next) ? current : next));
    },
    [],
  );

  return { route, navigate };
}
