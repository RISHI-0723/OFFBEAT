import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { Suspense, lazy } from "react";
import Home from "./pages/Home";

const Discover = lazy(() => import("./pages/Discover"));
const SignIn = lazy(() => import("./pages/SignIn"));
const Judge = lazy(() => import("./pages/Judge"));
const RecommendationNew = lazy(() => import("./pages/RecommendationNew"));
const RecommendationDetail = lazy(() => import("./pages/RecommendationDetail"));
const Creator = lazy(() => import("./pages/Creator"));
const Referral = lazy(() => import("./pages/Referral"));
const EventPage = lazy(() => import("./pages/Event"));
const Door = lazy(() => import("./pages/Door"));
const CuratorDashboard = lazy(() => import("./pages/CuratorDashboard"));
const SponsorDashboard = lazy(() => import("./pages/SponsorDashboard"));
const PoolDetail = lazy(() => import("./pages/PoolDetail"));
const Impact = lazy(() => import("./pages/Impact"));
const NotFound = lazy(() => import("./pages/NotFound"));

export default function App() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1280px] px-8 py-16"><Loading /></div>}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="discover" element={<Discover />} />
          <Route path="signin" element={<SignIn />} />
          <Route path="judge" element={<Judge />} />
          <Route path="recommendations/new" element={<RecommendationNew />} />
          <Route path="recommendations/:slug" element={<RecommendationDetail />} />
          <Route path="creators/:slug" element={<Creator />} />
          <Route path="r/:code" element={<Referral />} />
          <Route path="events/:slug" element={<EventPage />} />
          <Route path="events/:slug/door" element={<Door />} />
          <Route path="dashboard/curator" element={<CuratorDashboard />} />
          <Route path="dashboard/sponsor" element={<SponsorDashboard />} />
          <Route path="pools/:id" element={<PoolDetail />} />
          <Route path="impact" element={<Impact />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
