Feature: Permission workflow

  @smoke
  Scenario: focuses Reject with the keyboard
    Given a permission terminal is running
    When I move focus to Reject
    Then Reject is focused

  Scenario: records an actionless business rule
    Given the approval policy is already recorded
