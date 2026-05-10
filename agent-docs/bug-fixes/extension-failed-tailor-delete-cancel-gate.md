# Extension Failed Tailor Delete Cancel Gate

Failed tailor runs are returned as active cards so users can see and clean them up. The extension delete handlers used to optimistically hide the card, then send `JOB_HELPER_CANCEL_CURRENT_TAILORING` before the delete request. The backend rejects canceling failed runs because they are no longer active, so the optimistic removal rolled back and the card appeared to be undeletable.

The fix is to skip the cancel step when the card/current run is already in an error or `FAILED` state, and go directly to `deleteTailoredResumeArtifact`. Keep the existing optimistic rollback path for actual delete failures so the failed card reappears if the backend delete does not succeed.
