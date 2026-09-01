import { ButtonLink, EmptyState, Panel } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-24">
      <Panel>
        <EmptyState
          title="Nothing here"
          action={
            <ButtonLink href="/" variant="primary">
              Back to the start
            </ButtonLink>
          }
        >
          That intent, receipt or page does not exist on this deployment. Intents live only where
          they were created — verification, though, works anywhere: paste the receipt JSON on the
          verify page and every check is recomputed locally.
        </EmptyState>
      </Panel>
    </div>
  );
}
