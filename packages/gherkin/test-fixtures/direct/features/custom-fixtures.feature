Feature: custom fixtures

  @project
  Scenario: receives a typed extended fixture
    Given the project fixture is available
    When the project fixture owns a scenario resource
    Then every step has received the same project fixture
