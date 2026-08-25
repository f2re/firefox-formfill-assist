// Compatibility alias for @types/firefox-webext-browser 120.x.
// Firefox emits this payload through tabs.onActivated; newer code uses a clearer public name.
declare namespace browser {
  namespace tabs {
    type OnActivatedActiveInfoType = _OnActivatedActiveInfo;
  }
}
