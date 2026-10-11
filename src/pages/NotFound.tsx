import { ButtonLink, EmptyState } from "../components/ui";

export default function NotFound() {
  return (
    <EmptyState title="That page is off the beat" action={<ButtonLink to="/">Back to the start</ButtonLink>}>
      The link may be mistyped or the page may have moved.
    </EmptyState>
  );
}
