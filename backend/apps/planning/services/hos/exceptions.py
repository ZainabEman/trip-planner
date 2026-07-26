"""Custom exceptions for the HOS engine foundation.

No FMCSA rule violations are modeled yet — these are purely structural
and input-validation errors for the engine's scaffolding. Concrete rule
violation exceptions (11-hour limit exceeded, etc.) arrive with concrete
RuleEvaluator implementations in a later phase.
"""


class HOSEngineError(Exception):
    """Base class for every error the HOS engine can raise."""


class InvalidPlanningContextError(HOSEngineError):
    """Raised when a PlanningContext is constructed with invalid or incomplete inputs."""


class InvalidStateTransitionError(HOSEngineError):
    """Raised when the state machine cannot record a requested transition.

    Only structural problems (e.g. a transition timestamped before the
    previous one) are checked here — never an FMCSA rule.
    """


class TimelineAssemblyError(HOSEngineError):
    """Raised when TimelineBuilder cannot assemble a structurally consistent
    timeline (e.g. two events overlap in time).
    """
