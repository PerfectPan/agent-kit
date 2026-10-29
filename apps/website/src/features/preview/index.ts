export { PreviewNotice } from "./preview-notice.tsx";

export const previewMeta = import.meta.env.SITE_PREVIEW_PR ? [{ name: "robots", content: "noindex" }] : [];
