/**
 * Scroll `container` just far enough to show `el`, like scrollIntoView({ block: 'nearest' }) but without
 * moving any other scrollable ancestor. scrollIntoView also scrolls the Grafana page window, which pushes
 * the plugin toolbar off screen because the plugin root is taller than the viewport.
 */
export function scrollWithinContainer(el: Element, container: Element, behavior: ScrollBehavior = 'auto'): void {
  const elRect = el.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  if (elRect.top < containerRect.top) {
    container.scrollTo({ top: container.scrollTop - (containerRect.top - elRect.top), behavior });
  } else if (elRect.bottom > containerRect.bottom) {
    container.scrollTo({ top: container.scrollTop + (elRect.bottom - containerRect.bottom), behavior });
  }
}
