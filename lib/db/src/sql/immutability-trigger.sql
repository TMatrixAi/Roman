-- Database-level backstop for the "settle once" rule on evaluation_predictions.
--
-- Application code already guards the only settlement write
-- (services/evaluation/settle.ts) with `WHERE status = 'pending'`, so it can never
-- fire twice. This trigger makes the outcome itself structurally immutable at the
-- database layer too: once a row has left 'pending' (graded/void/missed), its
-- settlement columns (status, actual winner, result type, accuracy inclusion,
-- graded-at) can never change again, regardless of which code path attempts it.
--
-- Two columns are deliberately exempt because they are legitimate post-settlement
-- bookkeeping, not outcome tampering: `calibrated_probability` (the walk-forward
-- runner re-applies a fold's freshly-fitted calibration mapping to its own
-- just-inserted, already-graded historical_test rows) and `fold_id` (backfilled
-- once the owning evaluation_runs row exists, right after insert). Every other
-- column -- including who won and whether the result counts -- is frozen.
--
-- Idempotent (CREATE OR REPLACE / DROP + CREATE) so it can be re-applied safely on
-- every push.
CREATE OR REPLACE FUNCTION evaluation_predictions_prevent_settled_update()
RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'pending' AND (
    NEW.status IS DISTINCT FROM OLD.status OR
    NEW.actual_winner_id IS DISTINCT FROM OLD.actual_winner_id OR
    NEW.actual_winner_name IS DISTINCT FROM OLD.actual_winner_name OR
    NEW.result_type IS DISTINCT FROM OLD.result_type OR
    NEW.included_in_accuracy IS DISTINCT FROM OLD.included_in_accuracy OR
    NEW.graded_at IS DISTINCT FROM OLD.graded_at OR
    NEW.raw_probability IS DISTINCT FROM OLD.raw_probability OR
    NEW.predicted_winner_id IS DISTINCT FROM OLD.predicted_winner_id OR
    NEW.predicted_winner_name IS DISTINCT FROM OLD.predicted_winner_name OR
    NEW.player1_id IS DISTINCT FROM OLD.player1_id OR
    NEW.player2_id IS DISTINCT FROM OLD.player2_id OR
    NEW.scheduled_start_at IS DISTINCT FROM OLD.scheduled_start_at OR
    NEW.cutoff_at IS DISTINCT FROM OLD.cutoff_at
  ) THEN
    RAISE EXCEPTION
      'evaluation_predictions row % is already settled (status=%) and its outcome cannot be modified',
      OLD.id, OLD.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS evaluation_predictions_immutable_after_settle ON evaluation_predictions;

CREATE TRIGGER evaluation_predictions_immutable_after_settle
  BEFORE UPDATE ON evaluation_predictions
  FOR EACH ROW
  EXECUTE FUNCTION evaluation_predictions_prevent_settled_update();
