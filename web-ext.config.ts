import { defineWebExtConfig } from "wxt";

// Don't launch a separate browser for `wxt dev`: the build is loaded unpacked
// into Graham's own Chrome, which keeps his logins.
export default defineWebExtConfig({ disabled: true });
