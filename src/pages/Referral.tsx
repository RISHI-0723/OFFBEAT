import { useEffect } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { rememberReferral } from "../lib/referral";
import { ButtonLink, EmptyState, Loading } from "../components/ui";

/** /r/:code — a curator's shareable link. Remembers the code, then sends the visitor to the event. */
export default function Referral() {
  const { code = "" } = useParams();
  const q = useQuery({ queryKey: ["referral", code], queryFn: () => api.get<{ code: string; recommendationSlug: string; eventSlug: string | null }>(`/api/referrals/${code}`), retry: false });

  useEffect(() => {
    if (q.data?.eventSlug) rememberReferral(q.data.eventSlug, q.data.code);
  }, [q.data]);

  if (q.isLoading) return <Loading label="Opening referral link" />;
  if (q.isError)
    return (
      <EmptyState title="That referral link is not valid" action={<ButtonLink to="/discover">Browse recommendations</ButtonLink>}>
        It may have been mistyped or the recommendation was removed.
      </EmptyState>
    );
  const d = q.data!;
  return <Navigate replace to={d.eventSlug ? `/events/${d.eventSlug}?ref=${d.code}` : `/recommendations/${d.recommendationSlug}`} />;
}
