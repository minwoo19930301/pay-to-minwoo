import { Route, Routes } from "react-router-dom";
import { detectLocale, getApiBaseUrl, isDomesticTestEnabled } from "./lib/browser";
import { copy } from "./lib/content";
import { HomePage } from "./pages/HomePage";
import { SuccessPage } from "./pages/SuccessPage";
import { CancelPage } from "./pages/CancelPage";
import { AdminPage } from "./pages/AdminPage";
import { PortOneRedirectPage } from "./pages/PortOneRedirectPage";

export default function App() {
  const locale = detectLocale();
  const selectedCopy = copy[locale];
  const apiBaseUrl = getApiBaseUrl();
  const domesticTestEnabled = isDomesticTestEnabled();

  return (
    <div className="bg-background text-on-surface min-h-screen flex flex-col overflow-x-hidden">
      <Routes>
        <Route path="/" element={<HomePage apiBaseUrl={apiBaseUrl} copy={selectedCopy} domesticTestEnabled={domesticTestEnabled} locale={locale} />} />
        <Route path="/success" element={<SuccessPage copy={selectedCopy} />} />
        <Route path="/cancel" element={<CancelPage copy={selectedCopy} />} />
        <Route path="/portone/redirect" element={<PortOneRedirectPage apiBaseUrl={apiBaseUrl} />} />
        <Route path="/admin" element={<AdminPage apiBaseUrl={apiBaseUrl} />} />
      </Routes>
    </div>
  );
}
