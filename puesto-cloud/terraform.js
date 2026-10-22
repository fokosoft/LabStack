// Puesto Cloud · Terraform (fase 3): el código manda.
//
// ~/infra declara el security group de los frontales y el bloqueo de acceso
// público del bucket de backups. `terraform plan` compara lo declarado con lo
// que hay de verdad en la cuenta (st.aws) y enseña la deriva; `terraform apply`
// deja la cuenta como dice el código. Un cambio a mano no es un arreglo: es
// deriva que el siguiente apply deshará.
(function (P) {
'use strict';
const U = P.u, T = P.T, L = U.L, N = P.nube, ID = N.ID;
const INFRA = U.HOME + '/infra';
// Lo que dice el código.
const REGLAS_WEB = () => [
  { proto: 'tcp', desde: 80, hasta: 80, cidr: '0.0.0.0/0', desc: 'HTTP' },
  { proto: 'tcp', desde: 443, hasta: 443, cidr: '0.0.0.0/0', desc: 'HTTPS' },
  { proto: 'tcp', desde: 22, hasta: 22, sg: ID.sg.bastion, desc: T('SSH desde el bastion', 'SSH from the bastion') },
];
const BLOQUEO = { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true };
const clave = r => [r.proto, r.desde, r.hasta, r.cidr || '', r.sg || ''].join('|');

const fijo = arr => ({ lineas: () => arr, mb: arr.join('\n').length / 1048576 });
P.ficheros.push((st, h) => {
  if (h.rol !== 'ops' || !st.aws) return {};
  const f = {};
  f[INFRA + '/README.md'] = fijo(T(['# infra', '', 'Lo que está aquí lo gestiona Terraform: no se toca a mano en la consola ni con la CLI.', '', '  cd ~/infra', '  terraform plan     # qué cambiaría (y si hay deriva)', '  terraform apply    # dejarlo como dice el código', '', 'Si hace falta un cambio, se hace en el .tf y se aplica. Si alguien lo ha hecho a mano, el plan lo enseña.'],
    ['# infra', '', 'Everything here is managed by Terraform: do not change it by hand in the console or with the CLI.', '', '  cd ~/infra', '  terraform plan     # what would change (and whether there is drift)', '  terraform apply    # make it match the code', '', 'If something needs changing, change the .tf file and apply it. If someone changed it by hand, the plan shows it.']));
  f[INFRA + '/main.tf'] = fijo(['terraform {', '  required_version = ">= 1.9"', '  required_providers {', '    aws = { source = "hashicorp/aws", version = "~> 5.67" }', '  }', '  backend "s3" {', '    bucket = "tienda-tfstate"', '    key    = "infra/terraform.tfstate"', '    region = "eu-west-1"', '  }', '}', '', 'provider "aws" {', '  region = "eu-west-1"', '}']);
  f[INFRA + '/web.tf'] = fijo(['resource "aws_security_group" "web" {', '  name        = "tienda-web"', '  description = "' + N.sg(st, ID.sg.web).desc + '"', '  vpc_id      = "' + ID.vpc + '"', '']
    .concat(...REGLAS_WEB().map(r => ['  ingress {', '    description = "' + r.desc + '"', '    from_port   = ' + r.desde, '    to_port     = ' + r.hasta, '    protocol    = "tcp"', r.cidr ? '    cidr_blocks = ["' + r.cidr + '"]' : '    security_groups = [aws_security_group.bastion.id]', '  }', '']))
    .concat(['  egress {', '    from_port   = 0', '    to_port     = 0', '    protocol    = "-1"', '    cidr_blocks = ["0.0.0.0/0"]', '  }', '}']));
  f[INFRA + '/s3.tf'] = fijo(['resource "aws_s3_bucket_public_access_block" "backups" {', '  bucket                  = "tienda-catalogo-backups"', '  block_public_acls       = true', '  ignore_public_acls      = true', '  block_public_policy     = true', '  restrict_public_buckets = true', '}']);
  f[INFRA + '/.terraform.lock.hcl'] = fijo(['provider "registry.terraform.io/hashicorp/aws" {', '  version     = "5.67.0"', '  constraints = "~> 5.67"', '}']);
  return f;
});

// ------------------------------------------------------------------ plan
function deriva(st) {
  const g = N.sg(st, ID.sg.web), hay = g.reglas.map(clave), quiero = REGLAS_WEB().map(clave);
  const sobran = g.reglas.filter(r => quiero.indexOf(clave(r)) < 0), faltan = REGLAS_WEB().filter(r => hay.indexOf(clave(r)) < 0);
  const b = N.bucket(st, 'tienda-catalogo-backups'), bl = b.bloqueo || {};
  const bloqueo = Object.keys(BLOQUEO).filter(k => bl[k] !== true);
  return { sobran, faltan, bloqueo, cambios: (sobran.length || faltan.length ? 1 : 0) + (bloqueo.length ? 1 : 0) };
}
N.derivaTf = deriva;
const TF_KEY = { BlockPublicAcls: 'block_public_acls', IgnorePublicAcls: 'ignore_public_acls', BlockPublicPolicy: 'block_public_policy', RestrictPublicBuckets: 'restrict_public_buckets' };
function regla(r, signo) {
  const s = signo + ' ', p = '          ';
  return [p + s + '{', p + '    ' + signo + ' cidr_blocks      = [' + (r.cidr ? '"' + r.cidr + '"' : '') + ']', p + '    ' + signo + ' description      = "' + (r.desc || '') + '"', p + '    ' + signo + ' from_port        = ' + r.desde,
    p + '    ' + signo + ' protocol         = "tcp"', p + '    ' + signo + ' security_groups  = [' + (r.sg ? '"' + r.sg + '"' : '') + ']', p + '    ' + signo + ' to_port          = ' + r.hasta, p + '        # (3 unchanged attributes hidden)', p + '    },'];
}
function plan(st) {
  const d = deriva(st), out = [L('aws_security_group.web: Refreshing state... [id=' + ID.sg.web + ']'), L('aws_s3_bucket_public_access_block.backups: Refreshing state... [id=tienda-catalogo-backups]'), L('')];
  if (!d.cambios) return { d, lineas: out.concat([L('No changes. Your infrastructure matches the configuration.', 'verde'), L(''), L('Terraform has compared your real infrastructure against your configuration and found no differences, so no changes are needed.')]) };
  out.push(L('Terraform used the selected providers to generate the following execution plan. Resource actions are indicated with the following symbols:'), L('  ~ update in-place', 'ambar'), L(''), L('Terraform will perform the following actions:'), L(''));
  if (d.sobran.length || d.faltan.length) {
    out.push(L('  # aws_security_group.web will be updated in-place', 'ambar'), L('  ~ resource "aws_security_group" "web" {', 'ambar'), L('        id                     = "' + ID.sg.web + '"'), L('      ~ ingress                = [', 'ambar'));
    d.sobran.forEach(r => regla(r, '-').forEach(t => out.push(L(t, 'rojo'))));
    d.faltan.forEach(r => regla(r, '+').forEach(t => out.push(L(t, 'verde'))));
    out.push(L('            # (' + (REGLAS_WEB().length - d.faltan.length) + ' unchanged elements hidden)', 'dim'), L('        ]'), L('        name                   = "tienda-web"'), L('        # (7 unchanged attributes hidden)', 'dim'), L('    }'), L(''));
  }
  if (d.bloqueo.length) {
    out.push(L('  # aws_s3_bucket_public_access_block.backups will be updated in-place', 'ambar'), L('  ~ resource "aws_s3_bucket_public_access_block" "backups" {', 'ambar'));
    d.bloqueo.forEach(k => out.push(L('      ~ ' + TF_KEY[k].padEnd(23) + ' = false -> true', 'ambar')));
    out.push(L('        id                      = "tienda-catalogo-backups"'), L('        # (1 unchanged attribute hidden)', 'dim'), L('    }'), L(''));
  }
  out.push(L('Plan: 0 to add, ' + d.cambios + ' to change, 0 to destroy.'));
  return { d, lineas: out };
}
function aplicar(st) {
  const d = deriva(st), out = [];
  if (d.sobran.length || d.faltan.length) {
    const g = N.sg(st, ID.sg.web), quiero = REGLAS_WEB();
    g.reglas = quiero.map(r => g.reglas.find(x => clave(x) === clave(r)) || Object.assign({ id: 'sgr-0' + U.hex('tf' + clave(r) + st.reloj, 16) }, r));
    out.push(L('aws_security_group.web: Modifying... [id=' + ID.sg.web + ']'), L('aws_security_group.web: Modifications complete after 2s [id=' + ID.sg.web + ']'));
  }
  if (d.bloqueo.length) {
    N.bucket(st, 'tienda-catalogo-backups').bloqueo = Object.assign({}, BLOQUEO);
    out.push(L('aws_s3_bucket_public_access_block.backups: Modifying... [id=tienda-catalogo-backups]'), L('aws_s3_bucket_public_access_block.backups: Modifications complete after 1s [id=tienda-catalogo-backups]'));
  }
  st.aws.tfAplicado = (st.aws.tfAplicado || 0) + 1;
  return out.concat([L(''), L('Apply complete! Resources: 0 added, ' + d.cambios + ' changed, 0 destroyed.', 'verde')]);
}

U.cmd('terraform', { donde: ['ops'], fuera: T('(Terraform está en tu equipo: cd ~/infra)', '(Terraform lives on your workstation: cd ~/infra)'), grupo: T('Automatización', 'Automation'),
  ayuda: T('infraestructura como código: cd ~/infra y terraform plan / apply', 'infrastructure as code: cd ~/infra, then terraform plan / apply'),
  completar: (st, ses, pal) => !pal.length ? ['init', 'plan', 'apply', 'show', 'state', 'validate', 'version'] : pal[0] === 'state' ? ['list'] : pal[0] === 'apply' ? ['-auto-approve'] : [],
  fn: ctx => {
    const st = ctx.st, a = ctx.args, sub = a[0];
    if (sub === 'version' || sub === '-version' || sub === '--version') return [L('Terraform v1.9.5'), L('on linux_amd64'), L('+ provider registry.terraform.io/hashicorp/aws v5.67.0')];
    if (!sub) return [L('Usage: terraform [global options] <subcommand> [args]'), L(''), L('Main commands:'), L('  init          Prepare your working directory for other commands'), L('  validate      Check whether the configuration is valid'), L('  plan          Show changes required by the current configuration'), L('  apply         Create or update infrastructure'), L('  destroy       Destroy previously-created infrastructure')];
    if (ctx.ses.cwd !== INFRA) return [L('', 'err'), L('Error: No configuration files', 'err'), L(''), L('Plan requires configuration to be present. Planning without a configuration would mark everything for destruction, which is normally not what is desired. If you would like to destroy everything, run plan with the -destroy option. Otherwise, create a Terraform configuration file (.tf file) and try again.', 'err'), L(T('(la configuración está en ~/infra: cd ~/infra)', '(the configuration lives in ~/infra: cd ~/infra)'), 'dim')];
    if (sub === 'init') return [L(''), L('Initializing the backend...'), L(''), L('Initializing provider plugins...'), L('- Reusing previous version of hashicorp/aws from the dependency lock file'), L('- Using previously-installed hashicorp/aws v5.67.0'), L(''), L('Terraform has been successfully initialized!', 'verde')];
    if (sub === 'validate') return [L('Success! The configuration is valid.', 'verde')];
    if (sub === 'fmt') return [];
    if (sub === 'state' && a[1] === 'list') return [L('aws_s3_bucket_public_access_block.backups'), L('aws_security_group.web')];
    if (sub === 'show') { const g = N.sg(st, ID.sg.web); return [L('# aws_security_group.web:'), L('resource "aws_security_group" "web" {'), L('    id          = "' + ID.sg.web + '"'), L('    name        = "tienda-web"'), L('    ingress     = [')].concat(g.reglas.map(r => L('        { from_port = ' + r.desde + ', to_port = ' + r.hasta + ', ' + (r.cidr ? 'cidr_blocks = ["' + r.cidr + '"]' : 'security_groups = ["' + r.sg + '"]') + ' },'))).concat([L('    ]'), L('}')]); }
    if (sub === 'plan') return { lineas: plan(st).lineas, minutos: 1 };
    if (sub === 'apply' || sub === 'destroy') {
      if (sub === 'destroy') return [L(T('(el simulador no destruye la tienda: prueba plan y apply)', '(the simulator will not destroy the store: try plan and apply)'), 'dim')];
      const p = plan(st);
      if (!p.d.cambios) return { lineas: p.lineas.concat([L(''), L('Apply complete! Resources: 0 added, 0 changed, 0 destroyed.', 'verde')]), minutos: 1 };
      if (a.indexOf('-auto-approve') >= 0) return { lineas: p.lineas.concat([L('')], aplicar(st)), minutos: 1 };
      ctx.ses.pendiente = { prompt: '  Enter a value: ', responder: (st2, ses2, resp) => resp !== 'yes' ? { lineas: [L(''), L('Apply cancelled.', 'ambar')] } : { lineas: [L('')].concat(aplicar(st2)), minutos: 1 } };
      return { lineas: p.lineas.concat([L(''), L('Do you want to perform these actions?'), L('  Terraform will perform the actions described above.'), L("  Only 'yes' will be accepted to approve."), L('')]), minutos: 1 };
    }
    return [L('Terraform has no command named "' + sub + '".', 'err')];
  } });
})(window.PUESTO = window.PUESTO || {});
