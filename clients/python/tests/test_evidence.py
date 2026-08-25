from termwright.evidence import (
    ApplicationActionStrategyProvider,
    ApplicationFocusEvidenceProvider,
    ApplicationPaintEvidenceProvider,
    ApplicationScrollEvidenceProvider,
    ApplicationTerminalInputModeEvidenceProvider,
    EvidenceProviderLifecycleError,
    EvidenceProviderRegistry,
    EvidenceRevisionContext,
)


def provider(provider_id="keys"):
    return ApplicationActionStrategyProvider(
        id=provider_id,
        version="1",
        method="native",
        observe=lambda _context: [
            {
                "recipient": {"testId": "editor"},
                "recipes": [
                    {
                        "action": "setValue",
                        "requiresFocus": True,
                        "steps": [
                            {"kind": "press", "key": "Control+U"},
                            {"kind": "insert-action-value"},
                        ],
                    }
                ],
            }
        ],
    )


def test_freezes_action_strategy_declaration_and_revision_evidence():
    registry = EvidenceProviderRegistry()
    registry.register_action_strategies(provider())
    lease = registry.freeze()
    assert lease.registrations == (
        {
            "id": "keys",
            "version": "1",
            "method": "native",
            "capabilities": ["action-recipes"],
        },
    )
    frames = lease.collect(
        EvidenceRevisionContext("s1", 3, 80, 24),
        lambda recipient: "n-editor" if recipient == {"testId": "editor"} else "bad",
    )
    assert frames[0]["status"] == "available"
    assert frames[0]["revision"] == 3
    assert frames[0]["actionRecipes"][0]["recipientId"] == "n-editor"


def test_late_registration_and_provider_loss_fail_closed():
    registry = EvidenceProviderRegistry()
    registration = registry.register_action_strategies(provider())
    lease = registry.freeze()
    try:
        registry.register_action_strategies(provider("late"))
    except EvidenceProviderLifecycleError:
        pass
    else:
        raise AssertionError("late provider registration was accepted")
    registration.close()
    frames = lease.collect(EvidenceRevisionContext("s1", 4, 80, 24), lambda _: "n1")
    assert frames[0]["status"] == "lost"


def test_multiple_providers_are_not_resolved_by_registration_order():
    registry = EvidenceProviderRegistry()
    registry.register_action_strategies(provider("first"))
    registry.register_action_strategies(provider("second"))
    assert len(registry.freeze().registrations) == 2


def test_focus_provider_distinguishes_focused_from_authoritative_none():
    registry = EvidenceProviderRegistry()
    registry.register_focus(
        ApplicationFocusEvidenceProvider(
            id="focus",
            version="1",
            method="native",
            observe=lambda context: {"testId": "editor"} if context.revision == 1 else None,
        )
    )
    lease = registry.freeze()
    assert lease.registrations[0]["capabilities"] == ["focus-state"]
    focused = lease.collect(
        EvidenceRevisionContext("s", 1, 80, 24), lambda _recipient: "n-editor"
    )[0]
    assert focused["focusState"] == {"status": "focused", "recipientId": "n-editor"}
    none = lease.collect(
        EvidenceRevisionContext("s", 2, 80, 24), lambda _recipient: "n-editor"
    )[0]
    assert none["focusState"] == {"status": "none"}


def test_scroll_provider_publishes_bounded_application_viewport_state():
    registry = EvidenceProviderRegistry()
    registry.register_scroll(
        ApplicationScrollEvidenceProvider(
            id="scroll",
            version="1",
            method="native",
            observe=lambda _context: [{
                "recipient": {"testId": "results"},
                "axis": "vertical",
                "offset": 3,
                "viewport": 4,
                "extent": 20,
            }],
        )
    )
    lease = registry.freeze()
    assert lease.registrations[0]["capabilities"] == ["scroll-state"]
    frame = lease.collect(
        EvidenceRevisionContext("s", 1, 80, 24), lambda _recipient: "n-results"
    )[0]
    assert frame["scrollStates"] == [{
        "recipientId": "n-results",
        "axis": "vertical",
        "offset": 3,
        "viewport": 4,
        "extent": 20,
    }]


def test_paint_provider_publishes_exact_production_painter_cells():
    registry = EvidenceProviderRegistry()
    registry.register_paint(
        ApplicationPaintEvidenceProvider(
            id="paint",
            version="1",
            method="native",
            observe=lambda _context: [{
                "recipient": {"testId": "results"},
                "regionBounds": {"row": 2, "column": 3, "width": 4, "height": 2},
                "spans": [
                    {"row": 2, "from": 3, "to": 7},
                    {"row": 3, "from": 4, "to": 6},
                ],
            }],
        )
    )
    lease = registry.freeze()
    assert lease.registrations[0]["capabilities"] == ["painted-regions"]
    frame = lease.collect(
        EvidenceRevisionContext("s", 1, 80, 24), lambda _recipient: "n-results"
    )[0]
    assert frame["paintedRegions"] == [{
        "recipientId": "n-results",
        "regionBounds": {"row": 2, "column": 3, "width": 4, "height": 2},
        "spans": [
            {"row": 2, "from": 3, "to": 7},
            {"row": 3, "from": 4, "to": 6},
        ],
    }]


def test_input_mode_provider_publishes_production_parser_configuration():
    registry = EvidenceProviderRegistry()
    registry.register_input_modes(
        ApplicationTerminalInputModeEvidenceProvider(
            id="input",
            version="1",
            method="native",
            observe=lambda _context: {
                "mouseTracking": "drag",
                "mouseEncoding": "sgr",
                "focusReporting": "on",
            },
        )
    )
    lease = registry.freeze()
    assert lease.registrations[0]["capabilities"] == ["terminal-input-modes"]
    frame = lease.collect(EvidenceRevisionContext("s", 1, 80, 24), lambda _: "unused")[0]
    assert frame["inputModes"] == {
        "mouseTracking": "drag",
        "mouseEncoding": "sgr",
        "focusReporting": "on",
    }
