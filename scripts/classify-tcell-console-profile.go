// Command classify-tcell-console-profile identifies the audited Windows
// console shape exposed by an exact tcell source tree. It parses Go syntax
// only: candidate code is never loaded or executed.
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
)

type result struct {
	Profiles []profileResult `json:"profiles"`
}

type profileResult struct {
	SourceRoot string   `json:"sourceRoot"`
	Matches    []string `json:"matches"`
}

func main() {
	if len(os.Args) < 2 {
		fail("usage: classify-tcell-console-profile SOURCE_ROOT [SOURCE_ROOT ...]")
	}
	profiles := make([]profileResult, 0, len(os.Args)-1)
	for _, sourceRoot := range os.Args[1:] {
		profiles = append(profiles, profileResult{SourceRoot: sourceRoot, Matches: classify(sourceRoot)})
	}
	if err := json.NewEncoder(os.Stdout).Encode(result{Profiles: profiles}); err != nil {
		fail(err.Error())
	}
}

func classify(sourceRoot string) []string {
	files := parseFiles(sourceRoot, "console_win.go", "screen.go")
	common := hasStructFields(files, "cScreen", "out", "fini") &&
		hasEmbeddedSelector(files, "cScreen", "sync", "Mutex") &&
		hasStructField(files, "baseScreen", "screenImpl") &&
		hasConsoleConstruction(files) &&
		hasSemanticWriter(files)
	matches := []string{}
	if common && hasStructField(files, "cScreen", "vten") && initEnablesVT(files) {
		matches = append(matches, "old-vten")
	}
	if common && initFailsWithoutVT(files) {
		matches = append(matches, "vt-required")
	}
	return matches
}

func fail(message string) {
	_, _ = fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}

func parseFiles(root string, names ...string) []*ast.File {
	fset := token.NewFileSet()
	files := make([]*ast.File, 0, len(names))
	for _, name := range names {
		path := filepath.Join(root, name)
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			fail(fmt.Sprintf("parse %s: %v", name, err))
		}
		if file.Name.Name != "tcell" {
			fail(fmt.Sprintf("%s declares package %s, expected tcell", name, file.Name.Name))
		}
		files = append(files, file)
	}
	return files
}

func structType(files []*ast.File, name string) *ast.StructType {
	for _, file := range files {
		for _, declaration := range file.Decls {
			general, ok := declaration.(*ast.GenDecl)
			if !ok || general.Tok != token.TYPE {
				continue
			}
			for _, specification := range general.Specs {
				typeSpec, ok := specification.(*ast.TypeSpec)
				if !ok || typeSpec.Name.Name != name {
					continue
				}
				structure, _ := typeSpec.Type.(*ast.StructType)
				return structure
			}
		}
	}
	return nil
}

func hasStructField(files []*ast.File, typeName, fieldName string) bool {
	structure := structType(files, typeName)
	if structure == nil {
		return false
	}
	for _, field := range structure.Fields.List {
		if len(field.Names) == 0 && identifierName(field.Type) == fieldName {
			return true
		}
		for _, name := range field.Names {
			if name.Name == fieldName {
				return true
			}
		}
	}
	return false
}

func hasStructFields(files []*ast.File, typeName string, fieldNames ...string) bool {
	for _, fieldName := range fieldNames {
		if !hasStructField(files, typeName, fieldName) {
			return false
		}
	}
	return true
}

func hasEmbeddedSelector(files []*ast.File, typeName, packageName, selectorName string) bool {
	structure := structType(files, typeName)
	if structure == nil {
		return false
	}
	for _, field := range structure.Fields.List {
		if len(field.Names) != 0 {
			continue
		}
		selector, ok := field.Type.(*ast.SelectorExpr)
		packageIdentifier, packageOK := selectorX(selector)
		if ok && packageOK && packageIdentifier.Name == packageName && selector.Sel.Name == selectorName {
			return true
		}
	}
	return false
}

func selectorX(selector *ast.SelectorExpr) (*ast.Ident, bool) {
	if selector == nil {
		return nil, false
	}
	identifier, ok := selector.X.(*ast.Ident)
	return identifier, ok
}

func hasConsoleConstruction(files []*ast.File) bool {
	function := findFunction(files, "NewConsoleScreen", "")
	if function == nil {
		return false
	}
	found := false
	ast.Inspect(function.Body, func(node ast.Node) bool {
		literal, ok := node.(*ast.CompositeLit)
		if !ok || identifierName(literal.Type) != "baseScreen" {
			return true
		}
		for _, element := range literal.Elts {
			keyed, ok := element.(*ast.KeyValueExpr)
			if !ok || identifierName(keyed.Key) != "screenImpl" {
				continue
			}
			unary, ok := keyed.Value.(*ast.UnaryExpr)
			child, childOK := unary.X.(*ast.CompositeLit)
			if ok && unary.Op == token.AND && childOK && identifierName(child.Type) == "cScreen" {
				found = true
			}
		}
		return !found
	})
	return found
}

func hasSemanticWriter(files []*ast.File) bool {
	function := findFunction(files, "emitVtString", "cScreen")
	if function == nil || function.Recv == nil || len(function.Recv.List) != 1 || len(function.Recv.List[0].Names) != 1 {
		return false
	}
	receiver := function.Recv.List[0].Names[0].Name
	for _, statement := range function.Body.List {
		expression, ok := statement.(*ast.ExprStmt)
		if !ok {
			assignment, assignmentOK := statement.(*ast.AssignStmt)
			if !assignmentOK || len(assignment.Rhs) != 1 {
				continue
			}
			expression = &ast.ExprStmt{X: assignment.Rhs[0]}
		}
		call, ok := expression.X.(*ast.CallExpr)
		if !ok || len(call.Args) == 0 {
			continue
		}
		called, ok := call.Fun.(*ast.SelectorExpr)
		packageIdentifier, packageOK := selectorX(called)
		output, outputOK := call.Args[0].(*ast.SelectorExpr)
		outputReceiver, receiverOK := selectorX(output)
		if ok && packageOK && packageIdentifier.Name == "syscall" && called.Sel.Name == "WriteConsole" &&
			outputOK && receiverOK && outputReceiver.Name == receiver && output.Sel.Name == "out" {
			return true
		}
	}
	return false
}

func initEnablesVT(files []*ast.File) bool {
	function := findFunction(files, "Init", "cScreen")
	if function == nil || function.Recv == nil || len(function.Recv.List) != 1 || len(function.Recv.List[0].Names) != 1 {
		return false
	}
	receiver := function.Recv.List[0].Names[0].Name
	return hasVTRoundTrip(function.Body, receiver, token.EQL, func(block *ast.BlockStmt) bool {
		return directlyEnablesVT(block, receiver)
	})
}

func directlyEnablesVT(block *ast.BlockStmt, receiver string) bool {
	for _, node := range block.List {
		assignment, ok := node.(*ast.AssignStmt)
		if !ok || len(assignment.Lhs) != 1 || len(assignment.Rhs) != 1 {
			continue
		}
		field, ok := assignment.Lhs[0].(*ast.SelectorExpr)
		fieldReceiver, receiverOK := selectorX(field)
		value, valueOK := assignment.Rhs[0].(*ast.Ident)
		if ok && receiverOK && valueOK && fieldReceiver.Name == receiver && field.Sel.Name == "vten" && value.Name == "true" {
			return true
		}
	}
	return false
}

func initFailsWithoutVT(files []*ast.File) bool {
	function := findFunction(files, "Init", "cScreen")
	if function == nil || function.Recv == nil || len(function.Recv.List) != 1 || len(function.Recv.List[0].Names) != 1 {
		return false
	}
	receiver := function.Recv.List[0].Names[0].Name
	return hasVTRoundTrip(function.Body, receiver, token.NEQ, directlyReturnsNonNil)
}

func hasVTRoundTrip(block *ast.BlockStmt, receiver string, operator token.Token, acceptsBody func(*ast.BlockStmt) bool) bool {
	setVT := false
	modeVariable := ""
	for _, statement := range block.List {
		if call := statementCall(statement); call != nil && receiverMethodCall(call, receiver, "setOutMode") && containsIdentifier(call.Args, "modeVtOutput") {
			setVT = true
			modeVariable = ""
			continue
		}
		if setVT {
			if call := statementCall(statement); call != nil && receiverMethodCall(call, receiver, "getOutMode") && len(call.Args) == 1 {
				if address, ok := call.Args[0].(*ast.UnaryExpr); ok && address.Op == token.AND {
					modeVariable = identifierName(address.X)
				}
			}
			if conditional, ok := statement.(*ast.IfStmt); ok && modeVariable != "" && isVTModeComparison(conditional.Cond, operator, modeVariable) && acceptsBody(conditional.Body) {
				return true
			}
		}
		for _, child := range statementBlocks(statement) {
			if hasVTRoundTrip(child, receiver, operator, acceptsBody) {
				return true
			}
		}
	}
	return false
}

func statementCall(statement ast.Stmt) *ast.CallExpr {
	expression, ok := statement.(*ast.ExprStmt)
	if !ok {
		return nil
	}
	call, _ := expression.X.(*ast.CallExpr)
	return call
}

func receiverMethodCall(call *ast.CallExpr, receiver, method string) bool {
	selector, ok := call.Fun.(*ast.SelectorExpr)
	calledReceiver, receiverOK := selectorX(selector)
	return ok && receiverOK && calledReceiver.Name == receiver && selector.Sel.Name == method
}

func containsIdentifier(expressions []ast.Expr, name string) bool {
	found := false
	for _, expression := range expressions {
		ast.Inspect(expression, func(node ast.Node) bool {
			identifier, ok := node.(*ast.Ident)
			if ok && identifier.Name == name {
				found = true
			}
			return !found
		})
	}
	return found
}

func statementBlocks(statement ast.Stmt) []*ast.BlockStmt {
	switch value := statement.(type) {
	case *ast.IfStmt:
		blocks := []*ast.BlockStmt{value.Body}
		if alternate, ok := value.Else.(*ast.BlockStmt); ok {
			blocks = append(blocks, alternate)
		}
		return blocks
	case *ast.ForStmt:
		return []*ast.BlockStmt{value.Body}
	case *ast.RangeStmt:
		return []*ast.BlockStmt{value.Body}
	case *ast.SwitchStmt:
		blocks := []*ast.BlockStmt{}
		for _, item := range value.Body.List {
			clause, ok := item.(*ast.CaseClause)
			if ok {
				blocks = append(blocks, &ast.BlockStmt{List: clause.Body})
			}
		}
		return blocks
	}
	return nil
}

func isVTModeComparison(expression ast.Expr, operator token.Token, modeVariable string) bool {
	binary, ok := expression.(*ast.BinaryExpr)
	if !ok || binary.Op != operator || identifierName(binary.Y) != "modeVtOutput" {
		return false
	}
	mask, ok := binary.X.(*ast.BinaryExpr)
	return ok && mask.Op == token.AND && identifierName(mask.X) == modeVariable && identifierName(mask.Y) == "modeVtOutput"
}

func directlyReturnsNonNil(block *ast.BlockStmt) bool {
	for _, node := range block.List {
		statement, ok := node.(*ast.ReturnStmt)
		if ok && len(statement.Results) > 0 {
			identifier, isIdentifier := statement.Results[0].(*ast.Ident)
			if !isIdentifier || identifier.Name != "nil" {
				return true
			}
		}
	}
	return false
}

func findFunction(files []*ast.File, name, receiverType string) *ast.FuncDecl {
	for _, file := range files {
		for _, declaration := range file.Decls {
			function, ok := declaration.(*ast.FuncDecl)
			if !ok || function.Name.Name != name {
				continue
			}
			if receiverType == "" && function.Recv == nil {
				return function
			}
			if receiverType != "" && function.Recv != nil && len(function.Recv.List) == 1 && receiverName(function.Recv.List[0].Type) == receiverType {
				return function
			}
		}
	}
	return nil
}

func receiverName(expression ast.Expr) string {
	if pointer, ok := expression.(*ast.StarExpr); ok {
		return identifierName(pointer.X)
	}
	return identifierName(expression)
}

func identifierName(expression ast.Expr) string {
	identifier, _ := expression.(*ast.Ident)
	if identifier == nil {
		return ""
	}
	return identifier.Name
}
