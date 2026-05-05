Tailor Resume pending Step 2 stale cleanup

- Step 2 pending-start runs are intentional wait states. Stale-run cleanup must not delete a `RUNNING` or `NEEDS_INPUT` run that still has a matching interview status of `pending`, `deciding`, or `ready`.
- Cleanup may remove terminal/orphan markers whose DB run is no longer active, but it should not invent a follow-up action. The user starts the chat explicitly from the side panel.
- Legacy `queued` interview status may still be parsed as `pending` for old profile payloads, but new code should not create queued markers or queue drain actions.
