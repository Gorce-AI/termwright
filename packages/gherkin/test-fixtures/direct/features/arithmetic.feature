Feature: arithmetic through Vitest

  Background:
    Given a starting value of 2

  Scenario Outline: adds examples
    When I add <amount>
    Then the result is <total>

    Examples:
      | amount | total |
      | 3      | 5     |
      | 4      | 6     |
