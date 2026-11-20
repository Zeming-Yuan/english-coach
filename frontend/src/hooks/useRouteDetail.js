import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 二级详情异步加载与 URL detailId 双向同步钩子。
 *
 * 统一封装挂载守卫、请求代数令牌（selection）防竞态、深链 404 回退及列表切换，
 * 避免后退中断在途请求时产生晚到挂载或误触课程打开/故事接触记录。
 */
export function useRouteDetail({
  detailId = null,
  onDetailChange,
  fetchItem,
  getItemId,
  onLoadError,
}) {
  const [activeItem, setActiveItem] = useState(null);
  const [routeOpening, setRouteOpening] = useState(
    () => Boolean(onDetailChange && detailId != null),
  );
  const selectionRef = useRef(0);
  const openingIdRef = useRef(null);
  const activeIdRef = useRef(null);
  const mountedRef = useRef(true);
  const fetchRef = useRef(fetchItem);
  const getIdRef = useRef(getItemId);
  const onErrorRef = useRef(onLoadError);
  fetchRef.current = fetchItem;
  getIdRef.current = getItemId;
  onErrorRef.current = onLoadError;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      selectionRef.current += 1;
      openingIdRef.current = null;
      activeIdRef.current = null;
    };
  }, []);

  const invalidate = useCallback(() => {
    selectionRef.current += 1;
    openingIdRef.current = null;
  }, []);

  const openItem = useCallback(
    async (id, { fromRoute = false, replace = false } = {}) => {
      const request = ++selectionRef.current;
      openingIdRef.current = id;
      if (fromRoute) setRouteOpening(true);
      try {
        const item = await fetchRef.current(id);
        if (!mountedRef.current || request !== selectionRef.current) return null;
        openingIdRef.current = null;
        const itemId = getIdRef.current(item);
        activeIdRef.current = itemId;
        setActiveItem(item);
        if (!fromRoute) {
          onDetailChange?.(itemId, { replace });
        }
        return item;
      } catch (error) {
        if (!mountedRef.current || request !== selectionRef.current) return null;
        openingIdRef.current = null;
        if (error?.status === 404) {
          activeIdRef.current = null;
          setActiveItem(null);
          onDetailChange?.(null, { replace: true });
          return null;
        }
        if (fromRoute) {
          onDetailChange?.(null, { replace: true });
        }
        onErrorRef.current?.(error, () => {
          if (mountedRef.current && request === selectionRef.current) {
            openItem(id, { replace });
          }
        }, id);
        return null;
      } finally {
        if (mountedRef.current && request === selectionRef.current && fromRoute) {
          setRouteOpening(false);
        }
      }
    },
    [onDetailChange],
  );

  const adoptItem = useCallback(
    (item, { syncRoute = true, replace = false } = {}) => {
      selectionRef.current += 1;
      openingIdRef.current = null;
      const itemId = item ? getIdRef.current(item) : null;
      activeIdRef.current = itemId;
      setRouteOpening(false);
      setActiveItem(item);
      if (syncRoute) {
        onDetailChange?.(itemId, { replace });
      }
    },
    [onDetailChange],
  );

  const closeItem = useCallback(
    (options) => {
      selectionRef.current += 1;
      openingIdRef.current = null;
      activeIdRef.current = null;
      setRouteOpening(false);
      setActiveItem(null);
      onDetailChange?.(null, options);
    },
    [onDetailChange],
  );

  const activeItemId = activeItem ? getItemId(activeItem) : null;

  useEffect(() => {
    if (!onDetailChange) return;
    if (detailId == null) {
      // 无论详情已挂载还是仍在途请求，回退列表时都递增令牌阻断晚到响应。
      if (activeItemId != null || openingIdRef.current != null || routeOpening) {
        selectionRef.current += 1;
        openingIdRef.current = null;
      }
      setRouteOpening(false);
      if (activeItemId != null) {
        activeIdRef.current = null;
        setActiveItem(null);
      }
      return;
    }
    if (activeItemId === detailId) {
      setRouteOpening(false);
      return;
    }
    if (openingIdRef.current === detailId) {
      return;
    }
    openItem(detailId, { fromRoute: true });
  }, [detailId, activeItemId, routeOpening, onDetailChange, openItem]);

  return {
    activeItem,
    setActiveItem,
    routeOpening,
    getSelectedId: () => openingIdRef.current ?? activeIdRef.current,
    invalidate,
    openItem,
    adoptItem,
    closeItem,
  };
}
