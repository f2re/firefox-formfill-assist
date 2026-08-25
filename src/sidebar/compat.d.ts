// Compatibility aliases for the Firefox and Preact type packages used by this project.
// Runtime behavior is unchanged: Firefox exposes the same tab activation payload,
// and HTML accepts the lowercase readonly attribute emitted by JSX.

declare namespace browser {
  namespace tabs {
    type OnActivatedActiveInfoType = _OnActivatedActiveInfo;
  }
}

declare module "preact" {
  namespace JSX {
    interface HTMLAttributes<RefType extends EventTarget = EventTarget> {
      readonly?: boolean;
    }
  }
}

export {};
