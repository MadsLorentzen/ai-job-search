def test_generation_contract_identity_is_deterministic():
    from webapp.services.input_identity import application_intelligence_generation_contract_identity
    first = application_intelligence_generation_contract_identity()
    second = application_intelligence_generation_contract_identity()
    assert first == second


def test_generation_contract_identity_has_expected_prefix():
    from webapp.services.input_identity import application_intelligence_generation_contract_identity
    identity = application_intelligence_generation_contract_identity()
    assert identity.startswith("aiintelgencontract_")


def test_generation_contract_identity_pinned_golden_value():
    """Golden-value regression: any change to the template table, connective
    allowlist, or version strings changes this hash. That is the point -- a
    silent generation-affecting change with no staleness signal is exactly
    the defect this identity exists to prevent. When this test fails after a
    deliberate Lane B change, update the expected hash AND confirm
    prompt_version/schema versions were bumped to match."""
    from webapp.services.input_identity import application_intelligence_generation_contract_identity
    identity = application_intelligence_generation_contract_identity()
    assert identity == "aiintelgencontract_2eed18634efe98f5c51b"
