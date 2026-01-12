type LaunchMenuInstance = {
  destroy: () => void;
  trigger: HTMLElement;
  dropdown: Element;
};

let _launchMenuInstance: LaunchMenuInstance | null = null;

export function initLaunchMenu() {
  // If already initialized, return existing instance (idempotent) *unless*
  // Astro has swapped the DOM and our element references are stale.
  if (_launchMenuInstance) {
    const currentTrigger = document.getElementById('launch-menu-trigger');
    const currentDropdown = document.querySelector('.launch-menu-dropdown');

    const stillValid =
      !!currentTrigger &&
      !!currentDropdown &&
      _launchMenuInstance.trigger === currentTrigger &&
      _launchMenuInstance.dropdown === currentDropdown &&
      _launchMenuInstance.trigger.isConnected &&
      _launchMenuInstance.dropdown.isConnected;

    if (stillValid) return _launchMenuInstance;

    // DOM changed: remove old listeners and re-bind to the new elements.
    _launchMenuInstance.destroy();
  }

  const launchMenuTrigger = document.getElementById('launch-menu-trigger');
  const launchMenuDropdown = document.querySelector('.launch-menu-dropdown');

  if (!launchMenuTrigger || !launchMenuDropdown) return null;

  const onToggle = (e: Event) => {
    e.stopPropagation();
    const isActive = launchMenuTrigger.classList.contains('active');

    if (isActive) {
      launchMenuTrigger.classList.remove('active');
      launchMenuDropdown.classList.remove('show');
    } else {
      launchMenuTrigger.classList.add('active');
      launchMenuDropdown.classList.add('show');
    }
  };

  const onDocumentClick = (e: MouseEvent) => {
    if (
      launchMenuTrigger.contains(e.target as Node) ||
      launchMenuDropdown.contains(e.target as Node)
    ) {
      return;
    }

    launchMenuTrigger.classList.remove('active');
    launchMenuDropdown.classList.remove('show');
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      launchMenuTrigger.classList.remove('active');
      launchMenuDropdown.classList.remove('show');
    }
  };

  launchMenuTrigger.addEventListener('click', onToggle);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeyDown);

  _launchMenuInstance = {
    trigger: launchMenuTrigger,
    dropdown: launchMenuDropdown,
    destroy() {
      launchMenuTrigger.removeEventListener('click', onToggle);
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onKeyDown);
      _launchMenuInstance = null;
    },
  };

  return _launchMenuInstance;
}

export default initLaunchMenu;
