import { PreviewBanner } from "../../components/preview-banner.tsx";

export function PreviewNotice() {
  const previewPr = import.meta.env.SITE_PREVIEW_PR;
  return previewPr ? <PreviewBanner label={`Preview of #${previewPr}`} /> : null;
}
