"""Keyword rules for skill-area classification.

Deliberately a plain, readable table rather than logic: this is the part of the
pipeline most likely to be wrong, and it has to be auditable at a glance. Every
tag carries a weight — distinctive terms score high, ambiguous ones score low.

Rules assign the SUBTOPIC too, so the weak-area drill can filter below skill area.
Anything the rules cannot separate confidently is handed to an LLM pass in
`04_classify.py` and cached; the rules are never quietly "improved" to hide that.
"""

from __future__ import annotations

# (skillArea, subtopic, weight, [patterns])
# Weights: 3 = decisive term, 2 = strong, 1 = weak corroboration.
RULES: list[tuple[str, str, int, list[str]]] = [
    # ── Extend the platform — 30-35%, the dominant band ──────────────────────
    ("extend-platform", "plug-ins / execution pipeline", 3, [
        r"\bplug-?in\b", r"IPlugin", r"IPluginExecutionContext", r"PluginRegistration",
        r"pre-?image", r"post-?image", r"PreEntityImages", r"PostEntityImages",
        r"\bpre-?validation\b", r"\bpre-?operation\b", r"\bpost-?operation\b",
        r"execution pipeline", r"\bIOrganizationService\b", r"IServiceProvider",
        r"sandbox isolation", r"plug-?in trace log", r"\bdepth\b.*\binfinite loop",
    ]),
    ("extend-platform", "custom API / custom actions", 3, [
        r"custom API", r"custom action", r"CustomAPIRequestParameter",
        r"bound action", r"unbound action", r"\bcustom process action\b",
    ]),
    ("extend-platform", "custom workflow activities", 3, [
        r"CodeActivity", r"custom workflow activity", r"WorkflowActivity",
        r"\bInArgument\b", r"\bOutArgument\b",
    ]),
    ("extend-platform", "Web API / Organization service", 2, [
        r"\bWeb API\b", r"OData", r"\$filter", r"\$expand", r"\$select",
        r"OrganizationServiceProxy", r"CrmServiceClient", r"ServiceClient",
        r"QueryExpression", r"FetchXml", r"FetchXML", r"RetrieveMultiple",
        r"ExecuteMultiple", r"\bbatch request\b", r"\bimpersonat",
    ]),
    ("extend-platform", "virtual and elastic tables", 3, [
        r"virtual (table|entity)", r"elastic table", r"virtual entity data provider",
    ]),
    ("extend-platform", "server-side business logic", 2, [
        r"rollup (column|field)", r"calculated (column|field)", r"alternate key",
        r"business logic", r"\bformula column\b", r"change tracking",
    ]),
    ("extend-platform", "Azure integration from Dataverse", 2, [
        r"service endpoint", r"\bwebhook\b", r"Azure Service Bus",
        r"ServiceBusPlugin", r"\bAzure Function\b",
    ]),

    # ── Extend the user experience — 10-15% ─────────────────────────────────
    ("extend-ux", "PCF code components", 3, [
        r"\bPCF\b", r"code component", r"ControlManifest", r"pac pcf",
        r"\bStandardControl\b", r"\bupdateView\b", r"\bgetOutputs\b", r"\binit\(",
        r"\bdestroy\(\)", r"manifest.*\bproperty\b", r"virtual control",
    ]),
    ("extend-ux", "client scripting / form API", 3, [
        r"formContext", r"Xrm\.Page", r"Xrm\.WebApi", r"Xrm\.Navigation",
        r"executionContext", r"\bonLoad\b", r"\bonChange\b", r"\bonSave\b",
        r"\bweb resource\b", r"JavaScript.*form", r"addOnChange", r"getAttribute\(",
    ]),
    ("extend-ux", "commands and ribbon", 3, [
        r"\bribbon\b", r"command bar", r"Ribbon Workbench", r"\bEnableRule\b",
        r"\bDisplayRule\b", r"command checker", r"\bmodern command\b",
    ]),

    # ── Develop integrations — 10-15% ───────────────────────────────────────
    ("integrations", "custom connectors", 3, [
        r"custom connector", r"connector definition", r"OpenAPI", r"\bSwagger\b",
        r"connector.*policy", r"\bpolicy template\b",
    ]),
    ("integrations", "Power Automate and Logic Apps", 2, [
        r"Power Automate", r"\bcloud flow\b", r"\bLogic App\b", r"\btrigger\b.*\bflow\b",
        r"\bflow\b.*\bconnector\b", r"desktop flow", r"\bRPA\b",
    ]),
    ("integrations", "external APIs and eventing", 2, [
        r"Azure Event", r"Event Hub", r"API Management", r"\bOAuth\b",
        r"\bthird-?party\b.*\bAPI\b", r"\bREST\b.*\bAPI\b", r"dual-?write",
        r"\bdata integration\b", r"\bKingswaySoft\b", r"\bSSIS\b",
    ]),

    # ── Build Power Platform solutions — 10-15% ─────────────────────────────
    ("build-solutions", "solutions and ALM", 3, [
        r"\bmanaged solution\b", r"\bunmanaged solution\b", r"solution segmentation",
        r"\bpublisher\b", r"\bprefix\b", r"stage for upgrade", r"\bsolution patch\b",
        r"\bholding solution\b", r"\bALM\b", r"solution layer",
    ]),
    ("build-solutions", "environment variables and connection references", 3, [
        r"environment variable", r"connection reference",
    ]),
    ("build-solutions", "pipelines and DevOps", 3, [
        r"Azure DevOps", r"\bGitHub Action", r"build pipeline", r"release pipeline",
        r"Power Platform Pipelines", r"\bpac cli\b", r"\bpac solution\b",
        r"Configuration Migration", r"Package Deployer", r"\bsource control\b",
    ]),

    # ── Implement Power Apps improvements — 10-15% ──────────────────────────
    ("apps-improvements", "canvas apps", 2, [
        r"canvas app", r"\bgallery\b", r"\bdelegation\b", r"\bdelegable\b",
        r"Power Fx", r"\bcollection\b.*\bapp\b", r"\bScreen\b.*\bcontrol\b",
    ]),
    ("apps-improvements", "model-driven apps: forms and views", 2, [
        r"model-driven app", r"\bmain form\b", r"\bquick view\b", r"\bsub-?grid\b",
        r"\bsite map\b", r"\bsitemap\b", r"\bview\b.*\bcolumn\b", r"\bbusiness rule\b",
        r"business process flow", r"\bcustom page\b",
    ]),
    ("apps-improvements", "portals and Power Pages", 3, [
        r"Power Pages", r"\bportal\b", r"\bLiquid\b", r"entity form metadata",
        r"\bweb template\b", r"\bweb role\b", r"entity list", r"\bwebform\b",
    ]),
    ("apps-improvements", "performance and monitoring", 2, [
        r"\bMonitor\b.*\bapp\b", r"performance.*\bapp\b", r"\bApp Checker\b",
        r"\bSolution Checker\b", r"\bapp insights\b", r"Application Insights",
    ]),

    # ── Create a technical design — 10-15% ──────────────────────────────────
    ("technical-design", "security model", 3, [
        r"security role", r"business unit", r"\bteam\b.*\baccess\b",
        r"field-?level security", r"\bcolumn security\b", r"\baccess team\b",
        r"\bowner team\b", r"hierarchy security", r"\bshare\b.*\brecord\b",
    ]),
    ("technical-design", "data modelling", 2, [
        r"\brelationship\b", r"\b1:N\b", r"\bN:N\b", r"\bmany-to-many\b",
        r"\blookup column\b", r"\bchoice column\b", r"\boption set\b",
        r"\bdata model\b", r"\bcascade\b", r"\bcascading\b",
    ]),
    ("technical-design", "requirements and licensing", 2, [
        r"\blicens", r"\bstorage capacity\b", r"\bAPI limit\b", r"service protection",
        r"\brequest limit\b", r"\bgap\b.*\bfit\b", r"\bfunctional requirement\b",
        r"\bnon-?functional\b", r"\bwhich solution should you recommend\b",
    ]),
]

#: A question must beat the runner-up by this margin to be assigned confidently.
#: Below it, the rules are guessing and the question goes to the LLM pass.
MIN_MARGIN = 2

#: Below this top score there is no real evidence either way.
MIN_SCORE = 3
